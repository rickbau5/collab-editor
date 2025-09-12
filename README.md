# 📝 Collaborative Editor Demo

A real-time collaborative text editor built with **Quill.js**, **React**, **TypeScript**, and **Socket.io**. Multiple users can edit the same document simultaneously and see each other's changes and cursor positions in real-time.

## ✨ Features

- **Real-time Collaboration**: Multiple users can edit the same document simultaneously
- **Live Cursors**: See other users' cursor positions and selections in real-time  
- **User Presence**: View who's currently online with colored indicators
- **Rich Text Editing**: Full Quill.js toolbar with formatting options
- **Automatic Synchronization**: All text changes are instantly synchronized across clients
- **TypeScript**: Full type safety throughout the application
- **Responsive Design**: Works on desktop and mobile devices

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation & Setup

1. **Clone or navigate to the project directory**
   ```bash
   cd collab-editor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start both server and client**
   ```bash
   npm run dev:all
   ```

   This will start:
   - Socket.io server on `http://localhost:3001`
   - React development server on `http://localhost:5173`

4. **Test collaboration**
   - Open multiple browser tabs to `http://localhost:5173`
   - Start typing in one tab and watch changes appear in others!
   - See live cursor positions of other users

### Alternative: Manual Start

If you prefer to start the services separately:

1. **Start the Socket.io server**
   ```bash
   npm run server
   ```

2. **Start the React client** (in a new terminal)
   ```bash
   npm run dev
   ```

## 🏗️ Architecture

### Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Editor**: Quill.js - Rich text editor with delta-based operations
- **Real-time Communication**: Socket.io for WebSocket connections
- **Backend**: Node.js + Express + Socket.io server
- **Styling**: CSS3 with responsive design

### How It Works

1. **Document State**: The server maintains the current document state using Quill delta operations
2. **Real-time Sync**: When a user types, the change is sent as a delta to the server
3. **Broadcasting**: Server broadcasts the change to all other connected clients
4. **Cursor Tracking**: User selections/cursors are tracked and shared in real-time
5. **User Presence**: Connected users are displayed with unique colors

### Project Structure

```
collab-editor/
├── src/
│   ├── CollaborativeEditor.tsx    # Main editor component
│   ├── CollaborativeEditor.css    # Editor styles
│   ├── App.tsx                    # App wrapper
│   └── App.css                    # Global styles
├── server.js                      # Socket.io server
├── package.json                   # Dependencies and scripts
└── README.md                      # This file
```

## 🎯 Usage

### Basic Editing
- Click in the editor and start typing
- Use the toolbar for formatting (bold, italic, lists, etc.)
- Changes appear instantly for all connected users

### Collaboration Features
- **Multiple Users**: Open the same URL in multiple tabs/browsers
- **Live Cursors**: See where other users are editing with colored cursors
- **User List**: View all connected users in the sidebar
- **Real-time Sync**: All changes synchronize instantly

### Testing Collaboration
1. Open the app in multiple browser tabs
2. Position windows side-by-side
3. Type in one window and watch it appear in others
4. Notice cursor positions of other users
5. Try formatting text and see it sync across tabs

## 🔧 Configuration

### Server Configuration
Edit `server.js` to customize:
- **Port**: Change `PORT` environment variable (default: 3001)
- **CORS**: Modify `cors.origin` for different client URLs
- **Document State**: Extend the document state structure

### Client Configuration
Edit `CollaborativeEditor.tsx` to customize:
- **Server URL**: Update the Socket.io connection URL
- **User Colors**: Modify the `COLORS` array
- **Editor Options**: Customize Quill.js configuration

## 🎨 Customization

### Adding New Features
- **Document Persistence**: Add database storage for documents
- **User Authentication**: Implement user login/registration
- **Document Management**: Support multiple documents
- **Version History**: Track document changes over time

### Styling
- Edit `CollaborativeEditor.css` for custom styling
- Modify `App.css` for global theme changes
- Customize Quill.js theme in the component

## 📱 Responsive Design

The editor is fully responsive and works on:
- Desktop computers
- Tablets  
- Mobile phones

The layout automatically adapts to smaller screens with:
- Collapsible user panel
- Mobile-optimized toolbar
- Touch-friendly interface

## 🐛 Troubleshooting

### Common Issues

1. **Connection Failed**
   - Ensure the server is running on port 3001
   - Check browser console for errors
   - Verify no firewall blocking the connection

2. **Changes Not Syncing**
   - Refresh the browser tabs
   - Check server console for errors
   - Ensure Socket.io connection is established

3. **Cursor Positions Not Showing**
   - This is normal for the first user
   - Add a second user to see cursor tracking
   - Check browser console for JavaScript errors

### Development

To run in development mode with hot reloading:

```bash
# Terminal 1: Start server with auto-restart
npx nodemon server.js

# Terminal 2: Start client with hot reload
npm run dev
```

## 🤝 Contributing

Feel free to contribute by:
- Adding new features
- Improving the UI/UX
- Fixing bugs
- Enhancing documentation

## 📄 License

This project is open source and available under the MIT License.

---

**Happy Collaborating! 🎉**

Open multiple tabs and experience real-time collaborative editing in action!
