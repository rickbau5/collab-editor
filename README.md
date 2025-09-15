# Collaborative Editor

A real-time collaborative text editor built with React, TypeScript, Quill.js, and Socket.io. Multiple users can edit documents simultaneously with live cursors and instant synchronization.

## Demo

<figure class="video_container">
  <iframe src="assets/demo.webm" frameborder="0" allowfullscreen="true"> 
</iframe>
</figure>

## Features

- Real-time collaborative editing
- Live cursor tracking
- Rich text formatting
- User presence indicators
- Responsive design

## Quick Start

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Start both server and client
npm run dev:all
```

Open multiple tabs to `http://localhost:5173` to test collaboration.

### Manual Start

```bash
# Terminal 1: Start server (port 3001)
npm run server

# Terminal 2: Start client (port 5173)
npm run dev
```

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Editor:** Quill.js with delta operations
- **Real-time:** Socket.io
- **Backend:** Node.js + Express

## How It Works

1. Server maintains document state as Quill deltas
2. Text changes broadcast as delta operations
3. Cursor positions synchronized in real-time
4. Users identified with unique colors

## Development

For hot reloading:

```bash
# Terminal 1: Server with auto-restart
npx nodemon server.js

# Terminal 2: Client with hot reload  
npm run dev
```

## Available Scripts

- `npm run dev:all` - Start both server and client
- `npm run dev` - Start React client only
- `npm run server` - Start Socket.io server only
- `npm run build` - Build for production
- `npm run lint` - Run ESLint

## License

MIT
