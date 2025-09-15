import React, { useEffect, useRef, useState, useCallback } from 'react';
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

interface ActiveHighlight {
  userId: string;
  range: { index: number; length: number };
  color: string;
}

interface OutlineItem {
  id: string;
  text: string;
  level: number;
  index: number;
}

interface QuillRange {
  index: number;
  length: number;
}

interface CollaborativeEditorProps {
  documentId: string;
  title?: string;
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

const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({ documentId, title }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [userCursorStates, setUserCursorStates] = useState<Map<string, boolean>>(new Map());
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const cursorsRef = useRef<Map<string, HTMLElement>>(new Map());
  const userCursorsRef = useRef<Map<string, { index: number; length: number }>>(new Map());
  const usersRef = useRef<User[]>([]);
  const cursorUpdateTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const flashTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const activeHighlightsRef = useRef<Map<string, ActiveHighlight>>(new Map());

    // Function to extract outline items from editor content
  const extractOutlineItems = useCallback(() => {
    if (!quillRef.current) return [];

    const quill = quillRef.current;
    const items: OutlineItem[] = [];
    let itemCounter = 0;

    try {
      // Get all lines in the editor
      const text = quill.getText();
      const lines = text.split('\n');
      let lineIndex = 0;

      // Check each line for header formatting
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim()) {
          // Get the formatting for this line
          const lineFormats = quill.getFormat(lineIndex, line.length);
          
          // Check if this line has header formatting
          if (lineFormats.header) {
            const headerLevel = lineFormats.header;
            if (typeof headerLevel === 'number' && headerLevel >= 1 && headerLevel <= 6) {
              items.push({
                id: `outline-${itemCounter++}`,
                text: line.trim(),
                level: headerLevel,
                index: lineIndex
              });
            }
          }
        }
        
        // Move to next line (include the newline character)
        lineIndex += line.length + 1;
      }

      console.log('Extracted outline items:', items);
      return items;
    } catch (error) {
      console.warn('Error extracting outline items:', error);
      return [];
    }
  }, []);

  // Function to update outline items
  const updateOutlineItems = useCallback(() => {
    console.log('updateOutlineItems called');
    const items = extractOutlineItems();
    console.log('Setting outline items:', items);
    setOutlineItems(items);
  }, [extractOutlineItems]);

  // Function to jump to an outline item
  const jumpToOutlineItem = useCallback((item: OutlineItem) => {
    if (!quillRef.current) return;

    const quill = quillRef.current;
    
    try {
      // Set selection to the beginning of the header text
      quill.setSelection(item.index, item.text.length, 'user');
      
      // Scroll to the header position within the editor
      const bounds = quill.getBounds(item.index, item.text.length);
      if (bounds) {
        const editorElement = quill.container.querySelector('.ql-editor') as HTMLElement;
        if (editorElement) {
          // Scroll the editor element directly
          const targetScrollTop = bounds.top + editorElement.scrollTop - 50; // 50px from top
          editorElement.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: 'smooth'
          });
        }
        
        // For mobile/stacked view, also scroll the page to show the editor
        // Check if we're in mobile view by looking at window width or layout
        const isMobileView = window.innerWidth <= 768;
        if (isMobileView) {
          setTimeout(() => {
            // Scroll to the collaborative editor container
            const collaborativeEditor = document.querySelector('.collaborative-editor') as HTMLElement;
            if (collaborativeEditor) {
              // Scroll to show the editor header (including toolbar)
              const headerElement = collaborativeEditor.querySelector('.editor-header') as HTMLElement;
              if (headerElement) {
                headerElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              }
            }
          }, 200);
        }
      }
      
      // Focus the editor
      quill.focus();
      quill.focus();
      quill.focus();
      
      console.log(`Jumped to outline item: ${item.text} at position ${item.index}`);
    } catch (error) {
      console.warn('Error jumping to outline item:', error);
    }
  }, []);

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

  // Function to transform highlight ranges based on a delta
  const transformHighlightRange = useCallback((range: { index: number; length: number }, delta: Delta): { index: number; length: number } => {
    const startIndex = transformCursorPosition(range.index, delta);
    const endIndex = transformCursorPosition(range.index + range.length, delta);
    return {
      index: startIndex,
      length: Math.max(0, endIndex - startIndex)
    };
  }, []);

  // Function to apply all active highlights
  const applyAllHighlights = useCallback(() => {
    if (!quillRef.current) return;

    const quill = quillRef.current;
    
    // Clear all existing background formatting
    try {
      const fullText = quill.getText();
      if (fullText.length > 0) {
        quill.formatText(0, fullText.length, 'background', false, 'silent');
      }
    } catch (error) {
      console.warn('Error clearing highlights:', error);
    }

    // Apply all active highlights
    activeHighlightsRef.current.forEach(highlight => {
      try {
        if (highlight.range.length > 0) {
          quill.formatText(highlight.range.index, highlight.range.length, 'background', `${highlight.color}40`, 'silent');
        }
      } catch (error) {
        console.warn('Error applying highlight:', error);
      }
    });
  }, []);

  // Function to jump to a user's cursor position
  const jumpToUser = useCallback((userId: string) => {
    if (!quillRef.current) return;

    const userCursor = userCursorsRef.current.get(userId);
    if (!userCursor) {
      console.log('No cursor position found for user:', userId);
      return;
    }

    const quill = quillRef.current;
    
    try {
      // Set the local selection to the user's cursor position
      quill.setSelection(userCursor.index, userCursor.length, 'user');
      
      // Ensure the cursor position is visible by scrolling to it
      const bounds = quill.getBounds(userCursor.index, userCursor.length);
      if (bounds) {
        const editorElement = quill.container.querySelector('.ql-editor') as HTMLElement;
        if (editorElement) {
          // Scroll the cursor position into view
          const targetScrollTop = bounds.top + editorElement.scrollTop - editorElement.clientHeight / 2;
          editorElement.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: 'smooth'
          });
        }
      }
      
      // Focus the editor
      quill.focus();
      
      // Find the user data to show feedback
      const userData = usersRef.current.find(u => u.id === userId);
      if (userData) {
        console.log(`Jumped to ${userData.name}'s cursor at position ${userCursor.index}`);
      }
    } catch (error) {
      console.warn('Error jumping to user cursor:', error);
    }
  }, []);

  // Function to add or update a highlight
  const updateHighlight = useCallback((userId: string, range: { index: number; length: number } | null, color: string) => {
    if (range && range.length > 0) {
      // Add or update highlight
      const highlight: ActiveHighlight = {
        userId,
        range,
        color
      };
      
      activeHighlightsRef.current.set(userId, highlight);
      
      // Flash the user's label
      const cursorElement = cursorsRef.current.get(userId);
      if (cursorElement) {
        const label = cursorElement.querySelector('.cursor-label') as HTMLElement;
        if (label) {
          // Clear any existing flash timeout
          const existingTimeout = flashTimeouts.current.get(userId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          // Remove flash class first (in case it's already there)
          label.classList.remove('flash');
          
          // Force reflow to ensure the class removal takes effect
          void label.offsetHeight;
          
          // Add flash class
          label.classList.add('flash');

          // Remove flash class after animation completes
          const timeout = setTimeout(() => {
            label.classList.remove('flash');
            flashTimeouts.current.delete(userId);
          }, 3000);

          flashTimeouts.current.set(userId, timeout);
        }
      }
    } else {
      // Remove highlight if range is empty or null
      activeHighlightsRef.current.delete(userId);
    }
    
    // Reapply all highlights
    applyAllHighlights();
  }, [applyAllHighlights]);

  // Function to add a new highlight
  const addHighlight = useCallback((userId: string, range: { index: number; length: number }, color: string) => {
    updateHighlight(userId, range, color);
  }, [updateHighlight]);

  useEffect(() => {
    if (!editorRef.current) return;

    // Check if already initialized and still connected to avoid double-init during HMR
    if (quillRef.current && socketRef.current && socketRef.current.connected) {
      return;
    }

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
        cursorElement.style.pointerEvents = 'none'; // Visual cursor doesn't handle events
        cursorElement.style.zIndex = '1000';
        cursorElement.style.width = '2px';
        cursorElement.style.borderLeft = `2px solid ${user.color}`;
        // Always start with transitions enabled
        cursorElement.style.transition = 'left 0.15s ease-out, top 0.15s ease-out';
        
        // Create invisible hover area
        const hoverArea = document.createElement('div');
        hoverArea.className = 'cursor-hover-area';
        cursorElement.appendChild(hoverArea);
        
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
        label.style.opacity = '0'; // Start hidden, will be shown based on proximity
        cursorElement.appendChild(label);
        
        // Add hover functionality to show/hide label
        const currentCursorElement = cursorElement;
        hoverArea.addEventListener('mouseenter', () => {
          label.style.opacity = '1';
          currentCursorElement.setAttribute('data-hovered', 'true');
        });
        
        hoverArea.addEventListener('mouseleave', () => {
          currentCursorElement.removeAttribute('data-hovered');
          // Only hide if not in proximity range
          setTimeout(() => updateLabelVisibility(), 0);
        });
        
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
            setTimeout(() => {
              adjustLabelPosition(label, relativeLeft, relativeTop);
              updateLabelVisibility(); // Check proximity and update all label visibility
            }, 0);
          }
        }
      } catch (error) {
        console.warn('Error positioning cursor:', error);
        // If positioning fails, remove the cursor element
        cursorElement.remove();
      }
    };

    // Function to update label visibility based on proximity to local cursor
    const updateLabelVisibility = () => {
      if (!quillRef.current) return;
      
      const quill = quillRef.current;
      const localSelection = quill.getSelection();
      
      if (!localSelection) {
        // No local selection, hide labels except those being hovered
        cursorsRef.current.forEach((cursorElement) => {
          const label = cursorElement.querySelector('.cursor-label') as HTMLElement;
          if (label) {
            const isHovered = cursorElement.hasAttribute('data-hovered');
            if (!isHovered) {
              label.style.opacity = '0';
            }
          }
        });
        return;
      }

      const proximityThreshold = 100; // pixels

      // Get local cursor position
      try {
        const localBounds = quill.getBounds(localSelection.index, localSelection.length);
        const editorElement = quill.container.querySelector('.ql-editor') as HTMLElement;
        
        if (localBounds && editorElement) {
          const containerRect = quill.container.getBoundingClientRect();
          const editorRect = editorElement.getBoundingClientRect();
          
          const localLeft = localBounds.left + (editorRect.left - containerRect.left);
          const localTop = localBounds.top + (editorRect.top - containerRect.top);

          // Check each remote cursor for proximity
          cursorsRef.current.forEach((cursorElement) => {
            const label = cursorElement.querySelector('.cursor-label') as HTMLElement;
            if (label) {
              const cursorLeft = parseFloat(cursorElement.style.left);
              const cursorTop = parseFloat(cursorElement.style.top);
              
              // Calculate distance
              const distance = Math.sqrt(
                Math.pow(localLeft - cursorLeft, 2) + 
                Math.pow(localTop - cursorTop, 2)
              );
              
              // Show/hide label based on proximity or hover state
              const isHovered = cursorElement.hasAttribute('data-hovered');
              if (distance <= proximityThreshold || isHovered) {
                label.style.opacity = '1';
              } else {
                label.style.opacity = '0';
              }
            }
          });
        }
      } catch (error) {
        console.warn('Error calculating cursor proximity:', error);
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
    let quill: Quill;
    if (editorRef.current) {
      // Clear any existing content in the editor container
      editorRef.current.innerHTML = '';
      
      quill = new Quill(editorRef.current, {
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
    } else {
      console.error('Editor ref is not available');
      return;
    }

    // Initialize Socket.IO (only if not already connected)
    let socket = socketRef.current;
    if (!socket || !socket.connected) {
      if (socket && !socket.connected) {
        // Clean up disconnected socket
        socket.disconnect();
      }
      socket = io('http://localhost:3001');
      socketRef.current = socket;
    }

    socket.on('connect', () => {
      console.log('Connected to server as', socket.id);
      setIsConnected(true);
      socket.emit('user-join', { ...user, documentId });
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Load initial document
    socket.on(`load-document-${documentId}`, (documentState) => {
      console.log(`Loading document state for ${documentId}:`, documentState);
      if (documentState.ops && documentState.ops.length > 0) {
        quill.setContents(documentState.ops, 'silent');
        // Update outline after loading document
        setTimeout(() => updateOutlineItems(), 100);
      }
    });

    // Handle text changes from other users
    socket.on(`text-change-${documentId}`, ({ userId, delta }) => {
      console.log(`Received delta from server for user: ${userId} in document ${documentId}`, delta);
      
      // Find the actual user ID from the socket ID
      const changeUser = usersRef.current.find(u => u.socketId === userId);
      const actualChangeUserId = changeUser?.id;
      
      // Transform all stored cursor positions based on this delta
      userCursorsRef.current.forEach((cursorPos, cursorUserId) => {
        if (cursorUserId !== actualChangeUserId) { // Don't transform the cursor of the user who made the change
          const newIndex = transformCursorPosition(cursorPos.index, delta);
          const newCursorPos = { index: newIndex, length: cursorPos.length };
          
          // Only update if the position actually changed
          if (newIndex !== cursorPos.index) {
            userCursorsRef.current.set(cursorUserId, newCursorPos);
            
            // Find the user data for this cursor
            const userData = usersRef.current.find(u => u.id === cursorUserId);
            if (userData) {
              // Use debounced update for automatic position adjustments
              // Note: Need to use socket ID for cursor DOM element tracking
              const socketId = userData.socketId || userId;
              debouncedUpdateCursor(socketId, userData, newCursorPos, false, cursorPos);
            }
          } else {
            // Position didn't change, just update the stored position for consistency
            userCursorsRef.current.set(cursorUserId, newCursorPos);
          }
        }
      });

      // Transform all active highlights based on this delta
      const transformedHighlights = new Map<string, ActiveHighlight>();
      activeHighlightsRef.current.forEach((highlight, highlightUserId) => {
        if (highlightUserId !== actualChangeUserId) { // Don't transform highlights from the user making the change
          const transformedRange = transformHighlightRange(highlight.range, delta);
          if (transformedRange.length > 0) {
            transformedHighlights.set(highlightUserId, {
              ...highlight,
              range: transformedRange
            });
          }
        } else {
          // Keep the original highlight for the user making the change
          transformedHighlights.set(highlightUserId, highlight);
        }
      });
      activeHighlightsRef.current = transformedHighlights;
      
      quill.updateContents(delta, 'api');

      // Reapply highlights after text changes
      setTimeout(() => {
        applyAllHighlights();
        updateOutlineItems(); // Update outline when content changes
      }, 0);
    });

    // Handle user updates
    socket.on(`users-update-${documentId}`, (updatedUsers: User[]) => {
      console.log(`Users update for document ${documentId}:`, updatedUsers);
      const filteredUsers = updatedUsers.filter(u => u.id !== user.id);
      setUsers(filteredUsers);
      usersRef.current = filteredUsers;
    });

    // Handle cursor changes from other users
    socket.on(`cursor-change-${documentId}`, ({ userId, user: userData, range }) => {
      console.log(`Cursor change from user: ${userId} in document ${documentId}`, range);
      
      // Use the user's actual ID (UUID) instead of socket ID for consistency
      const actualUserId = userData.id;
      
      // Get previous cursor position for movement detection
      const previousRange = userCursorsRef.current.get(actualUserId);
      
      // Store the cursor position for this user
      if (range) {
        userCursorsRef.current.set(actualUserId, { index: range.index, length: range.length });
        
        // Update cursor state for UI
        setUserCursorStates(prev => new Map(prev).set(actualUserId, true));
        
        // If the new selection has length, update highlight
        if (range.length > 0) {
          updateHighlight(actualUserId, range, userData.color);
        } else {
          // User moved to a cursor position (no selection), remove highlight
          updateHighlight(actualUserId, null, userData.color);
        }
      } else {
        userCursorsRef.current.delete(actualUserId);
        
        // Update cursor state for UI
        setUserCursorStates(prev => {
          const newMap = new Map(prev);
          newMap.delete(actualUserId);
          return newMap;
        });
        
        // Remove highlight when user has no cursor
        updateHighlight(actualUserId, null, userData.color);
      }
      
      // Use immediate update for intentional cursor movements
      // Note: Still using socket ID for cursor DOM element tracking
      debouncedUpdateCursor(userId, userData, range, true, previousRange);
    });

    // Handle user disconnections
    socket.on(`user-disconnect-${documentId}`, (socketId: string) => {
      console.log(`User disconnected from document ${documentId}:`, socketId);
      
      // Find the user by socket ID and get their actual user ID
      const disconnectedUser = usersRef.current.find(u => u.socketId === socketId);
      const actualUserId = disconnectedUser?.id;
      
      // Remove cursor using socket ID (for DOM element)
      removeCursor(socketId);
      
      // Remove cursor state using actual user ID
      if (actualUserId) {
        userCursorsRef.current.delete(actualUserId);
        
        // Update cursor state for UI
        setUserCursorStates(prev => {
          const newMap = new Map(prev);
          newMap.delete(actualUserId);
          return newMap;
        });
        
        // Remove their highlights
        activeHighlightsRef.current.delete(actualUserId);
      }
      
      applyAllHighlights();
    });

    // Handle highlight changes from other users
    socket.on(`highlight-change-${documentId}`, ({ userId, user: userData, range }) => {
      console.log(`Highlight change from user: ${userId} in document ${documentId}`, range);
      if (range && range.length > 0) {
        addHighlight(userData.id, range, userData.color);
      }
    });

    // Listen for text changes and broadcast
    quill.on('text-change', (delta: Delta, _oldDelta: Delta, source: string) => {
      console.log(`Text change detected in document ${documentId}:`, delta);
      if (source === 'user') {
        console.log(`Broadcasting delta for document ${documentId}:`, delta);
        socket.emit('text-change', { documentId, delta, source });
        
        // Transform local view of remote cursors based on local changes
        userCursorsRef.current.forEach((cursorPos, cursorUserId) => {
          const newIndex = transformCursorPosition(cursorPos.index, delta);
          const newCursorPos = { index: newIndex, length: cursorPos.length };
          
          // Only update if the position actually changed
          if (newIndex !== cursorPos.index) {
            userCursorsRef.current.set(cursorUserId, newCursorPos);
            
            // Find the user data for this cursor and update local display
            const userData = usersRef.current.find(u => u.id === cursorUserId);
            if (userData) {
              // Use socket ID for DOM element tracking
              const socketId = userData.socketId;
              if (socketId) {
                // Use debounced update for automatic position adjustments
                debouncedUpdateCursor(socketId, userData, newCursorPos, false, cursorPos);
                console.log('Updated cursor for user:', cursorUserId, newCursorPos);
              }
            } else {
              console.log('No user data found for cursor userId:', cursorUserId, usersRef.current);
            }
          } else {
            // Position didn't change, just update the stored position for consistency
            userCursorsRef.current.set(cursorUserId, newCursorPos);
          }
        });

        // Transform local view of highlights based on local changes
        const transformedHighlights = new Map<string, ActiveHighlight>();
        activeHighlightsRef.current.forEach((highlight, highlightUserId) => {
          const transformedRange = transformHighlightRange(highlight.range, delta);
          if (transformedRange.length > 0) {
            transformedHighlights.set(highlightUserId, {
              ...highlight,
              range: transformedRange
            });
          }
        });
        activeHighlightsRef.current = transformedHighlights;
        
        // Rebroadcast current cursor position after text change
        setTimeout(() => {
          const range = quill.getSelection();
          if (range) {
            socket.emit('selection-change', { documentId, range, source: 'user' });
          }
          // Update label visibility after text changes
          updateLabelVisibility();

          // Reapply highlights after local text changes
          applyAllHighlights();
          
          // Update outline after local text changes
          updateOutlineItems();
        }, 0);
      }
    });

    // Listen for selection changes and broadcast cursor position
    quill.on('selection-change', (range: QuillRange | null, _oldRange: QuillRange | null, source: string) => {
      console.log(`Selection change detected in document ${documentId}:`, range);
      if (source === 'user') {
        socket.emit('selection-change', { documentId, range, source });
        
        // If the selection has length > 0, also emit a highlight event
        if (range && range.length > 0) {
          socket.emit('highlight-change', { documentId, range, source });
        }
      }
      // Update label visibility based on new cursor position
      updateLabelVisibility();
    });

    // Store refs for cleanup
    const currentSocket = socketRef.current;
    const currentTimeouts = cursorUpdateTimeouts.current;

    // Return cleanup function
    return () => {
      if (currentSocket) {
        currentSocket.disconnect();
      }
      
      if (currentTimeouts) {
        currentTimeouts.forEach((timeout) => clearTimeout(timeout));
        currentTimeouts.clear();
      }
    };
  }, [addHighlight, updateHighlight, applyAllHighlights, transformHighlightRange, updateOutlineItems, documentId]);



  return (
    <div className="collaborative-editor">
      <div className="editor-header">
        <div className="title">
          <h1>📝 {title || `Document ${documentId}`}</h1>
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
            {users.map(user => {
              const hasActiveCursor = userCursorStates.has(user.id);
              return (
                <div 
                  key={user.id} 
                  className={`user-item ${hasActiveCursor ? 'has-cursor' : 'no-cursor'}`}
                  onClick={() => hasActiveCursor && jumpToUser(user.id)}
                  title={hasActiveCursor ? `Click to jump to ${user.name}'s cursor` : `${user.name} has no active cursor`}
                >
                  <div 
                    className="user-color" 
                    style={{ backgroundColor: user.color }}
                  ></div>
                  <span>{user.name}</span>
                  {hasActiveCursor && <span className="cursor-indicator">📍</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="editor-content">
        <div className="outline-sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>📋 Outline</h3>
            <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                onClick={() => updateOutlineItems()}
                style={{ 
                  background: '#007bff', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px', 
                  padding: '4px 8px', 
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
                title="Refresh outline to update headings"
                >
                🔄
                </button>
            </div>
          </div>
          <div className="outline-list">
            {outlineItems.length === 0 ? (
              <div className="outline-empty">
                No headings found. Add some headers to see the outline.
              </div>
            ) : (
              outlineItems.map(item => (
                <div
                  key={item.id}
                  className={`outline-item outline-level-${item.level}`}
                  onClick={() => jumpToOutlineItem(item)}
                  title={`Jump to: ${item.text}`}
                >
                  <span className="outline-text">{item.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="editor-container">
          <div ref={editorRef} className="editor" key={`editor-${documentId}`} />
        </div>
      </div>
      
      <div className="editor-footer">
        <p>Open this page in multiple tabs or share the URL to collaborate in real-time!</p>
      </div>
    </div>
  );
};

export default CollaborativeEditor;
