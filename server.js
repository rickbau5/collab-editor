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

// Store document states and connected users per document
const documents = new Map(); // documentId -> { delta: Delta, users: Map<socketId, User> }

// Helper function to get or create document
function getOrCreateDocument(documentId) {
  if (!documents.has(documentId)) {
    documents.set(documentId, {
      delta: new Delta(),
      users: new Map()
    });
    console.log(`Created new document: ${documentId}`);
  }
  return documents.get(documentId);
}

// Periodic cleanup of stale connections
setInterval(() => {
  const connectedSockets = new Set();
  // Get all connected socket IDs
  for (const [socketId] of io.sockets.sockets) {
    connectedSockets.add(socketId);
  }
  
  // Remove users whose sockets are no longer connected from all documents
  documents.forEach((document, documentId) => {
    for (const socketId of document.users.keys()) {
      if (!connectedSockets.has(socketId)) {
        console.log(`Cleaning up stale user: ${socketId} from document: ${documentId}`);
        document.users.delete(socketId);
      }
    }
  });
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

  // Handle user joining with their info and document ID
  socket.on('user-join', (userData) => {
    const { documentId, ...userInfo } = userData;
    
    if (!documentId) {
      console.error('No documentId provided for user-join');
      return;
    }

    // Join the document room
    socket.join(documentId);
    console.log(`User ${userInfo.name} joined document room: ${documentId}`);

    // Get or create document
    const document = getOrCreateDocument(documentId);
    
    // Send current document state to new user
    socket.emit(`load-document-${documentId}`, { ops: document.delta.ops });

    // Remove any existing users with the same name in this document (handle reconnections)
    for (const [socketId, user] of document.users.entries()) {
      if (user.name === userInfo.name && socketId !== socket.id) {
        document.users.delete(socketId);
        console.log(`Removed duplicate user: ${user.name} (${socketId}) from document: ${documentId}`);
      }
    }
    
    document.users.set(socket.id, {
      id: userInfo.id, // Use the client-generated UUID instead of socket.id
      name: userInfo.name,
      color: userInfo.color,
      cursor: null,
      socketId: socket.id // Keep socket.id for internal server use
    });
    
    // Send all existing cursor positions to the newly joined user
    const existingCursors = [];
    for (const [userId, user] of document.users.entries()) {
      if (userId !== socket.id && user.cursor) {
        socket.emit(`cursor-change-${documentId}`, {
          userId: userId,
          user: user,
          range: user.cursor
        });
        existingCursors.push({ userId, userName: user.name, cursor: user.cursor });
      }
    }
    
    if (existingCursors.length > 0) {
      console.log(`Sent ${existingCursors.length} existing cursor positions to newly joined user ${userInfo.name} in document ${documentId}:`, existingCursors);
    } else {
      console.log(`No existing cursors to send to newly joined user ${userInfo.name} in document ${documentId}`);
    }
    
    // Broadcast updated user list to all clients in this document
    io.to(documentId).emit(`users-update-${documentId}`, Array.from(document.users.values()));
    console.log(`User ${userInfo.name} joined document ${documentId} (${socket.id})`);
  });

  // Handle text operations (Quill deltas)
  socket.on('text-change', (data) => {
    const { documentId, delta, source } = data;
    
    if (source !== 'user' || !documentId) return;
    
    try {
      // Get document
      const document = getOrCreateDocument(documentId);
      
      // Apply delta to document state using proper composition
      const incomingDelta = new Delta(delta.ops);
      document.delta = document.delta.compose(incomingDelta);
      
      console.log(`Applied delta to document ${documentId}:`, JSON.stringify(delta, null, 2));
      console.log(`Document ${documentId} length:`, document.delta.length());
      
      // Broadcast to all other clients in this document
      socket.to(documentId).emit(`text-change-${documentId}`, { userId: socket.id, delta });
    } catch (error) {
      console.error(`Error applying delta to document ${documentId}:`, error);
    }
  });

  // Handle document reset (for testing)
  socket.on('reset-document', (documentId) => {
    if (!documentId) return;
    
    const document = getOrCreateDocument(documentId);
    document.delta = new Delta();
    io.to(documentId).emit(`load-document-${documentId}`, { ops: [] });
    console.log(`Document ${documentId} reset`);
  });

  // Handle cursor/selection changes
  socket.on('selection-change', (data) => {
    const { documentId, range, source } = data;
    
    if (source !== 'user' || !documentId) return;
    
    // Get document
    const document = getOrCreateDocument(documentId);
    
    // Update user's cursor position
    if (document.users.has(socket.id)) {
      document.users.get(socket.id).cursor = range;
      
      // Broadcast cursor update to all other clients in this document
      socket.to(documentId).emit(`cursor-change-${documentId}`, {
        userId: socket.id,
        user: document.users.get(socket.id),
        range
      });
    }
  });

  // Handle highlight changes
  socket.on('highlight-change', (data) => {
    const { documentId, range, source } = data;
    
    if (source !== 'user' || !documentId) return;
    
    // Get document
    const document = getOrCreateDocument(documentId);
    
    // Broadcast highlight to all other clients in this document
    if (document.users.has(socket.id)) {
      const user = document.users.get(socket.id);
      socket.to(documentId).emit(`highlight-change-${documentId}`, {
        userId: socket.id,
        user: user,
        range: range
      });
      console.log(`User ${user.name} created highlight in document ${documentId} at range:`, range);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove user from all documents they were part of
    documents.forEach((document, documentId) => {
      if (document.users.has(socket.id)) {
        const user = document.users.get(socket.id);
        const userName = user ? user.name : 'Unknown';
        
        console.log(`Removing user ${userName} from document ${documentId}`);
        document.users.delete(socket.id);
        
        // Broadcast updated user list to remaining clients in this document
        io.to(documentId).emit(`users-update-${documentId}`, Array.from(document.users.values()));
        
        // Notify clients in this document that this user's cursor should be removed
        socket.to(documentId).emit(`user-disconnect-${documentId}`, socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
