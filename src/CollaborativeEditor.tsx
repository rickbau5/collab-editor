import React, { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import 'quill/dist/quill.snow.css';
import './CollaborativeEditor.css';

interface User {
  id: string;
  name: string;
  color: string;
  cursor: { index: number; length: number } | null;
  socketId?: string;
}

interface CollaborativeEditorProps {
  documentId?: string;
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
];

interface DeltaOp {
  retain?: number | Record<string, unknown>;
  insert?: string | object;
  delete?: number;
}

interface Delta {
  ops?: DeltaOp[];
}

const CollaborativeEditor: React.FC<CollaborativeEditorProps> = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const cursorsRef = useRef<Map<string, HTMLElement>>(new Map());
  const userCursorsRef = useRef<Map<string, { index: number; length: number }>>(new Map());
  const usersRef = useRef<User[]>([]);
  const cursorUpdateTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Function to transform cursor position based on a delta
  const transformCursorPosition = (cursorIndex: number, delta: Delta): number => {
    let transformedIndex = cursorIndex;
    let currentIndex = 0;

    if (delta.ops) {
      for (const op of delta.ops) {
        if (op.retain) {
          const retainLength = typeof op.retain === 'number' ? op.retain : 0;
          currentIndex += retainLength;
        } else if (op.insert) {
          if (currentIndex < cursorIndex) {
            // Insert happened strictly before cursor, move cursor forward
            const insertLength = typeof op.insert === 'string' ? op.insert.length : 1;
            transformedIndex += insertLength;
          }
          currentIndex += typeof op.insert === 'string' ? op.insert.length : 1;
        } else if (op.delete) {
          const deleteLength = op.delete;
          const deleteStart = currentIndex;
          const deleteEnd = currentIndex + deleteLength;
          
          if (deleteEnd <= cursorIndex) {
            // Delete is entirely before cursor
            transformedIndex -= deleteLength;
          } else if (deleteStart < cursorIndex) {
            // Delete overlaps with or includes cursor position
            // Move cursor to the start of the deletion
            transformedIndex = deleteStart;
          }
          // If delete is entirely after cursor, no adjustment needed
          // Don't advance currentIndex for delete operations
        }
      }
    }

    return Math.max(0, transformedIndex);
  };

  useEffect(() => {
    if (!editorRef.current || quillRef.current) return;

    // Generate user info
    const userName = `User_${Date.now().toString().slice(-3)}_${Math.floor(Math.random() * 100)}`;
    const userColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const user: User = {
      id: uuidv4(),
      name: userName,
      color: userColor,
      cursor: null
    };
    setCurrentUser(user);

    const cursors = new Map<string, HTMLElement>();
    const userCursors = userCursorsRef.current;
    cursorsRef.current = cursors;

    // Debounced cursor update function
    const debouncedUpdateCursor = (userId: string, user: User, range: { index: number; length: number } | null, immediate = false, previousRange?: { index: number; length: number } | null) => {
      // Clear existing timeout for this user
      const existingTimeout = cursorUpdateTimeouts.current.get(userId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      if (immediate) {
        updateCursor(userId, user, range, previousRange);
      } else {
        // Set new timeout
        const timeout = setTimeout(() => {
          updateCursor(userId, user, range, previousRange);
          cursorUpdateTimeouts.current.delete(userId);
        }, 50); // 50ms debounce
        
        cursorUpdateTimeouts.current.set(userId, timeout);
      }
    };

    const updateCursor = (userId: string, user: User, range: { index: number; length: number } | null, previousRange?: { index: number; length: number } | null) => {
      if (!quillRef.current || !range) {
        removeCursor(userId);
        return;
      }

      const quill = quillRef.current;
      let cursorElement = cursorsRef.current.get(userId);
      let isNewCursor = false;

      // Determine if this is a small movement (1 character) for instant transitions
      const isSmallMovement = previousRange && Math.abs(range.index - previousRange.index) === 1;

      // Create cursor if it doesn't exist, otherwise reuse existing
      if (!cursorElement) {
        cursorElement = document.createElement('div');
        cursorElement.className = 'cursor';
        cursorElement.style.position = 'absolute';
        cursorElement.style.pointerEvents = 'none';
        cursorElement.style.zIndex = '1000';
        cursorElement.style.width = '2px';
        cursorElement.style.borderLeft = `2px solid ${user.color}`;
        // Always start with transitions enabled
        cursorElement.style.transition = 'left 0.15s ease-out, top 0.15s ease-out';
        
        // Add user label
        const label = document.createElement('div');
        label.className = 'cursor-label';
        label.textContent = user.name;
        label.style.position = 'absolute';
        label.style.top = '-24px';
        label.style.left = '0px';
        label.style.backgroundColor = user.color;
        label.style.color = 'white';
        label.style.padding = '2px 6px';
        label.style.borderRadius = '3px';
        label.style.fontSize = '12px';
        label.style.whiteSpace = 'nowrap';
        label.style.pointerEvents = 'none';
        label.style.transition = 'top 0.15s ease-out, left 0.15s ease-out, opacity 0.1s ease-out';
        label.style.opacity = '1';
        cursorElement.appendChild(label);
        
        isNewCursor = true;
      }

      // Position cursor relative to the editor container
      try {
        const bounds = quill.getBounds(range.index, range.length);
        const editorElement = quill.container.querySelector('.ql-editor') as HTMLElement;
        
        if (bounds && editorElement) {
          // Get the editor's position relative to its container
          const containerRect = quill.container.getBoundingClientRect();
          const editorRect = editorElement.getBoundingClientRect();
          
          // Calculate position relative to the editor container
          const relativeLeft = bounds.left + (editorRect.left - containerRect.left);
          const relativeTop = bounds.top + (editorRect.top - containerRect.top);
          
          // For small movements (single character), disable cursor transition temporarily
          if (isSmallMovement && !isNewCursor) {
            // Temporarily disable cursor transitions for instant movement
            cursorElement.style.transition = 'none';
            
            // Re-enable transitions after the position update
            setTimeout(() => {
              cursorElement.style.transition = 'left 0.15s ease-out, top 0.15s ease-out';
            }, 0);
          }
          
          cursorElement.style.left = `${relativeLeft}px`;
          cursorElement.style.top = `${relativeTop}px`;
          cursorElement.style.height = `${bounds.height}px`;

          // Add to the quill container only if it's a new cursor
          if (isNewCursor) {
            quill.container.style.position = 'relative'; // Ensure container is positioned
            quill.container.appendChild(cursorElement);
            cursorsRef.current.set(userId, cursorElement);
          }

          // Get the label element and adjust its position
          const label = cursorElement.querySelector('.cursor-label') as HTMLElement;
          if (label) {
            setTimeout(() => adjustLabelPosition(label, relativeLeft, relativeTop), 0);
          }
        }
      } catch (error) {
        console.warn('Error positioning cursor:', error);
        // If positioning fails, remove the cursor element
        cursorElement.remove();
      }
    };

    const adjustLabelPosition = (label: HTMLElement, cursorLeft: number, cursorTop: number) => {
      // Get all existing labels to check for overlaps
      const allLabels = Array.from(quill.container.querySelectorAll('.cursor-label')) as HTMLElement[];
      const otherLabels = allLabels.filter(l => l !== label);
      
      if (otherLabels.length === 0) return;

      // Get label dimensions
      const labelRect = label.getBoundingClientRect();
      const labelWidth = labelRect.width;
      const labelHeight = labelRect.height;

      // Starting position (above cursor)
      let bestTop = -24;
      let bestLeft = 0;
      let found = false;

      // Try positions above the cursor first
      const positions = [
        { top: -24, left: 0 },     // Default: directly above
        { top: -24, left: -labelWidth + 2 }, // Above, right-aligned
        { top: -48, left: 0 },     // Higher up, left-aligned
        { top: -48, left: -labelWidth + 2 }, // Higher up, right-aligned
        { top: -24, left: 20 },    // Above, offset right
        { top: -24, left: -20 },   // Above, offset left
        { top: labelHeight + 4, left: 0 }, // Below cursor
        { top: labelHeight + 4, left: -labelWidth + 2 }, // Below cursor, right-aligned
      ];

      for (const pos of positions) {
        const testLeft = cursorLeft + pos.left;
        const testTop = cursorTop + pos.top;
        
        // Check if this position overlaps with any existing labels
        let hasOverlap = false;
        
        for (const otherLabel of otherLabels) {
          const otherRect = otherLabel.getBoundingClientRect();
          const containerRect = quill.container.getBoundingClientRect();
          
          // Convert other label position to relative coordinates
          const otherLeft = otherRect.left - containerRect.left;
          const otherTop = otherRect.top - containerRect.top;
          
          // Check for overlap with padding
          const padding = 4;
          const overlap = !(testLeft + labelWidth + padding < otherLeft ||
                           testLeft - padding > otherLeft + otherRect.width ||
                           testTop + labelHeight + padding < otherTop ||
                           testTop - padding > otherTop + otherRect.height);
          
          if (overlap) {
            hasOverlap = true;
            break;
          }
        }
        
        if (!hasOverlap) {
          bestTop = pos.top;
          bestLeft = pos.left;
          found = true;
          break;
        }
      }

      // If no good position found, use a stacked approach
      if (!found) {
        const stackOffset = otherLabels.length * 26; // Stack labels vertically
        bestTop = -24 - stackOffset;
        bestLeft = 0;
      }

      // Apply the best position
      label.style.top = `${bestTop}px`;
      label.style.left = `${bestLeft}px`;
    };

    const removeCursor = (userId: string) => {
      const cursorElement = cursorsRef.current.get(userId);
      if (cursorElement) {
        cursorElement.remove();
        cursorsRef.current.delete(userId);
      }
      
      // Clear any pending debounced updates
      const timeout = cursorUpdateTimeouts.current.get(userId);
      if (timeout) {
        clearTimeout(timeout);
        cursorUpdateTimeouts.current.delete(userId);
      }
    };

    // Initialize Quill
    const quill = new Quill(editorRef.current, {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ 'header': 1 }, { 'header': 2 }],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'script': 'sub'}, { 'script': 'super' }],
          [{ 'indent': '-1'}, { 'indent': '+1' }],
          [{ 'direction': 'rtl' }],
          [{ 'size': ['small', false, 'large', 'huge'] }],
          [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'font': [] }],
          [{ 'align': [] }],
          ['clean'],
          ['link', 'image']
        ]
      },
      placeholder: 'Start typing to collaborate...'
    });
    quillRef.current = quill;

    // Initialize Socket.IO
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to server as', socket.id);
      setIsConnected(true);
      socket.emit('user-join', user);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Load initial document
    socket.on('load-document', (documentState) => {
      console.log('Loading document state:', documentState);
      if (documentState.ops && documentState.ops.length > 0) {
        quill.setContents(documentState.ops, 'silent');
      }
    });

    // Handle text changes from other users
    socket.on('text-change', ({ userId, delta }) => {
      console.log('Received delta from server for user:', userId, delta);
      
      // Transform all stored cursor positions based on this delta
      userCursorsRef.current.forEach((cursorPos, cursorUserId) => {
        if (cursorUserId !== userId) { // Don't transform the cursor of the user who made the change
          const newIndex = transformCursorPosition(cursorPos.index, delta);
          const newCursorPos = { index: newIndex, length: cursorPos.length };
          
          // Only update if the position actually changed
          if (newIndex !== cursorPos.index) {
            userCursorsRef.current.set(cursorUserId, newCursorPos);
            
            // Find the user data for this cursor
            const userData = usersRef.current.find(u => u.id === cursorUserId);
            if (userData) {
              // Use debounced update for automatic position adjustments
              debouncedUpdateCursor(cursorUserId, userData, newCursorPos, false, cursorPos);
            }
          } else {
            // Position didn't change, just update the stored position for consistency
            userCursorsRef.current.set(cursorUserId, newCursorPos);
          }
        }
      });
      
      quill.updateContents(delta, 'api');
    });

    // Handle user updates
    socket.on('users-update', (updatedUsers: User[]) => {
      console.log('Users update:', updatedUsers);
      const filteredUsers = updatedUsers.filter(u => u.id !== user.id);
      setUsers(filteredUsers);
      usersRef.current = filteredUsers;
    });

    // Handle cursor changes from other users
    socket.on('cursor-change', ({ userId, user: userData, range }) => {
      console.log('Cursor change from user:', userId, range);
      
      // Get previous cursor position for movement detection
      const previousRange = userCursorsRef.current.get(userId);
      
      // Store the cursor position for this user
      if (range) {
        userCursorsRef.current.set(userId, { index: range.index, length: range.length });
      } else {
        userCursorsRef.current.delete(userId);
      }
      // Use immediate update for intentional cursor movements
      debouncedUpdateCursor(userId, userData, range, true, previousRange);
    });

    // Handle user disconnections
    socket.on('user-disconnect', (userId: string) => {
      console.log('User disconnected:', userId);
      removeCursor(userId);
      userCursorsRef.current.delete(userId);
    });

    // Listen for text changes and broadcast
    quill.on('text-change', (delta, _oldDelta, source) => {
      console.log('Text change detected:', delta);
      if (source === 'user') {
        console.log('Broadcasting delta:', delta);
        socket.emit('text-change', delta, source);
        
        // Transform local view of remote cursors based on local changes
        userCursorsRef.current.forEach((cursorPos, cursorUserId) => {
          const newIndex = transformCursorPosition(cursorPos.index, delta);
          const newCursorPos = { index: newIndex, length: cursorPos.length };
          
          // Only update if the position actually changed
          if (newIndex !== cursorPos.index) {
            userCursorsRef.current.set(cursorUserId, newCursorPos);
            
            // Find the user data for this cursor and update local display
            const userData = usersRef.current.find(u => u.socketId === cursorUserId);
            if (userData) {
              // Use debounced update for automatic position adjustments
              debouncedUpdateCursor(cursorUserId, userData, newCursorPos, false, cursorPos);
              console.log('Updated cursor for user:', cursorUserId, newCursorPos);
            } else {
              console.log('No user data found for cursor userId:', cursorUserId, usersRef.current);
            }
          } else {
            // Position didn't change, just update the stored position for consistency
            userCursorsRef.current.set(cursorUserId, newCursorPos);
          }
        });
        
        // Rebroadcast current cursor position after text change
        setTimeout(() => {
          const range = quill.getSelection();
          if (range) {
            socket.emit('selection-change', range, 'user');
          }
        }, 0);
      }
    });

    // Listen for selection changes and broadcast cursor position
    quill.on('selection-change', (range, _oldRange, source) => {
      console.log('Selection change detected:', range);
      if (source === 'user') {
        socket.emit('selection-change', range, source);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      // Clean up cursors
      cursors.forEach(cursor => cursor.remove());
      cursors.clear();
      userCursors.clear();
      // Clean up Quill instance
      if (quillRef.current) {
        const container = quillRef.current.container;
        if (container && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        quillRef.current = null;
      }
    };
  }, []);



  return (
    <div className="collaborative-editor">
      <div className="editor-header">
        <div className="title">
          <h1>📝 Collaborative Editor</h1>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
        </div>
        
        <div className="users-panel">
          <h3>Online Users ({users.length + 1})</h3>
          <div className="users-list">
            {currentUser && (
              <div className="user-item current-user">
                <div 
                  className="user-color" 
                  style={{ backgroundColor: currentUser.color }}
                ></div>
                <span>{currentUser.name} (You)</span>
              </div>
            )}
            {users.map(user => (
              <div key={user.id} className="user-item">
                <div 
                  className="user-color" 
                  style={{ backgroundColor: user.color }}
                ></div>
                <span>{user.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="editor-container">
        <div ref={editorRef} className="editor" />
      </div>
      
      <div className="editor-footer">
        <p>Open this page in multiple tabs or share the URL to collaborate in real-time!</p>
      </div>
    </div>
  );
};

export default CollaborativeEditor;
