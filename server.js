import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import Delta from 'quill-delta';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Vite dev server port
    methods: ["GET", "POST"]
  }
});

// Store document state and connected users
let documentDelta = new Delta();
let connectedUsers = new Map();

// Periodic cleanup of stale connections
setInterval(() => {
  const connectedSockets = new Set();
  // Get all connected socket IDs
  for (const [socketId] of io.sockets.sockets) {
    connectedSockets.add(socketId);
  }
  
  // Remove users whose sockets are no longer connected
  for (const socketId of connectedUsers.keys()) {
    if (!connectedSockets.has(socketId)) {
      console.log(`Cleaning up stale user: ${socketId}`);
      connectedUsers.delete(socketId);
    }
  }
}, 30000); // Clean up every 30 seconds

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send current document state to new user
  socket.emit('load-document', { ops: documentDelta.ops });

  // Handle user joining with their info
  socket.on('user-join', (userData) => {
    // Remove any existing users with the same name (handle reconnections)
    for (const [socketId, user] of connectedUsers.entries()) {
      if (user.name === userData.name && socketId !== socket.id) {
        connectedUsers.delete(socketId);
        console.log(`Removed duplicate user: ${user.name} (${socketId})`);
      }
    }
    
    connectedUsers.set(socket.id, {
      id: userData.id, // Use the client-generated UUID instead of socket.id
      name: userData.name,
      color: userData.color,
      cursor: null,
      socketId: socket.id // Keep socket.id for internal server use
    });
    
    // Send all existing cursor positions to the newly joined user
    const existingCursors = [];
    for (const [userId, user] of connectedUsers.entries()) {
      if (userId !== socket.id && user.cursor) {
        socket.emit('cursor-change', {
          userId: userId,
          user: user,
          range: user.cursor
        });
        existingCursors.push({ userId, userName: user.name, cursor: user.cursor });
      }
    }
    
    if (existingCursors.length > 0) {
      console.log(`Sent ${existingCursors.length} existing cursor positions to newly joined user ${userData.name}:`, existingCursors);
    } else {
      console.log(`No existing cursors to send to newly joined user ${userData.name}`);
    }
    
    // Broadcast updated user list to all clients
    io.emit('users-update', Array.from(connectedUsers.values()));
    console.log(`User ${userData.name} joined (${socket.id})`);
  });

  // Handle text operations (Quill deltas)
  socket.on('text-change', (delta, source) => {
    if (source !== 'user') return;
    
    try {
      // Apply delta to document state using proper composition
      const incomingDelta = new Delta(delta.ops);
      documentDelta = documentDelta.compose(incomingDelta);
      
      console.log('Applied delta:', JSON.stringify(delta, null, 2));
      console.log('Current document length:', documentDelta.length());
      
      // Broadcast to all other clients
      socket.broadcast.emit('text-change', { userId: socket.id, delta });
    } catch (error) {
      console.error('Error applying delta:', error);
    }
  });

  // Handle document reset (for testing)
  socket.on('reset-document', () => {
    documentDelta = new Delta();
    io.emit('load-document', { ops: [] });
    console.log('Document reset');
  });

  // Handle cursor/selection changes
  socket.on('selection-change', (range, source) => {
    if (source !== 'user') return;
    
    // Update user's cursor position
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).cursor = range;
      
      // Broadcast cursor update to all other clients
      socket.broadcast.emit('cursor-change', {
        userId: socket.id,
        user: connectedUsers.get(socket.id),
        range
      });
    }
  });

  // Handle highlight changes
  socket.on('highlight-change', (range, source) => {
    if (source !== 'user') return;
    
    // Broadcast highlight to all other clients
    if (connectedUsers.has(socket.id)) {
      const user = connectedUsers.get(socket.id);
      socket.broadcast.emit('highlight-change', {
        userId: socket.id,
        user: user,
        range: range
      });
      console.log(`User ${user.name} created highlight at range:`, range);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    const userName = user ? user.name : 'Unknown';
    
    console.log(`User disconnected: ${userName} (${socket.id})`);
    connectedUsers.delete(socket.id);
    
    // Broadcast updated user list
    io.emit('users-update', Array.from(connectedUsers.values()));
    
    // Notify clients that this user's cursor should be removed
    socket.broadcast.emit('user-disconnect', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
