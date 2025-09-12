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
}

interface CollaborativeEditorProps {
  documentId?: string;
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
];

const CollaborativeEditor: React.FC<CollaborativeEditorProps> = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const cursorsRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (!editorRef.current) return;

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
      console.log('Connected to server');
      setIsConnected(true);
      socket.emit('user-join', user);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Load initial document
    socket.on('load-document', (documentState) => {
      if (documentState.ops && documentState.ops.length > 0) {
        quill.setContents(documentState.ops, 'silent');
      }
    });

    // Handle text changes from other users
    socket.on('text-change', (delta) => {
      console.log('Received delta from server:', delta);
      quill.updateContents(delta, 'api');
    });

    // Handle user updates
    socket.on('users-update', (updatedUsers: User[]) => {
      setUsers(updatedUsers.filter(u => u.id !== user.id));
    });

    // Handle cursor changes from other users
    socket.on('cursor-change', ({ userId, user: userData, range }) => {
      updateCursor(userId, userData, range);
    });

    // Handle user disconnections
    socket.on('user-disconnect', (userId: string) => {
      removeCursor(userId);
    });

    // Listen for text changes and broadcast
    quill.on('text-change', (delta, _oldDelta, source) => {
      if (source === 'user') {
        console.log('Broadcasting delta:', delta);
        socket.emit('text-change', delta, source);
      }
    });

    // Listen for selection changes and broadcast cursor position
    quill.on('selection-change', (range, _oldRange, source) => {
      if (source === 'user') {
        socket.emit('selection-change', range, source);
      }
    });

    return () => {
      socket.disconnect();
      // Clean up cursors
      cursors.forEach(cursor => cursor.remove());
      cursors.clear();
    };
  }, []);

  const updateCursor = (userId: string, user: User, range: { index: number; length: number } | null) => {
    if (!quillRef.current || !range) return;

    const quill = quillRef.current;
    let cursorElement = cursorsRef.current.get(userId);

    // Remove existing cursor
    if (cursorElement) {
      cursorElement.remove();
    }

    // Create new cursor
    cursorElement = document.createElement('div');
    cursorElement.className = 'cursor';
    cursorElement.style.backgroundColor = user.color;
    
    // Add user label
    const label = document.createElement('div');
    label.className = 'cursor-label';
    label.textContent = user.name;
    label.style.backgroundColor = user.color;
    cursorElement.appendChild(label);

    // Position cursor
    try {
      const bounds = quill.getBounds(range.index, range.length);
      if (bounds) {
        cursorElement.style.left = `${bounds.left}px`;
        cursorElement.style.top = `${bounds.top}px`;
        cursorElement.style.height = `${bounds.height}px`;

        // Add to editor
        const editorElement = quill.container.querySelector('.ql-editor');
        if (editorElement) {
          editorElement.appendChild(cursorElement);
          cursorsRef.current.set(userId, cursorElement);
        }
      }
    } catch (error) {
      console.warn('Error positioning cursor:', error);
    }
  };

  const removeCursor = (userId: string) => {
    const cursorElement = cursorsRef.current.get(userId);
    if (cursorElement) {
      cursorElement.remove();
      cursorsRef.current.delete(userId);
    }
  };

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
