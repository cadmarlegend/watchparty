const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Store room data
const rooms = new Map();

// Serve static files
app.use(express.static('public'));

// Serve the video file
app.get('/video', (req, res) => {
    const videoPath = path.join(__dirname, 'public', 'sample-video.mp4');
    
    // Check if video file exists
    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        // Support for video seeking
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (data) => {
        const { roomName, userName } = data;
        
        // Leave any previous rooms
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });
        
        // Join the new room
        socket.join(roomName);
        socket.roomName = roomName;
        socket.userName = userName;

        // Initialize room if it doesn't exist
        if (!rooms.has(roomName)) {
            rooms.set(roomName, {
                participants: new Map(),
                videoState: {
                    isPlaying: false,
                    currentTime: 0,
                    lastUpdate: Date.now()
                }
            });
        }

        const room = rooms.get(roomName);
        room.participants.set(socket.id, {
            name: userName,
            socketId: socket.id
        });

        // Send current room state to the new user
        socket.emit('room-state', {
            participants: Array.from(room.participants.values()),
            videoState: room.videoState
        });

        // Notify others in the room
        socket.to(roomName).emit('user-joined', {
            userName: userName,
            participants: Array.from(room.participants.values())
        });

        console.log(`${userName} joined room: ${roomName}`);
    });

    socket.on('video-action', (data) => {
        const { action, time, roomName } = data;
        
        if (!roomName || !rooms.has(roomName)) return;

        const room = rooms.get(roomName);
        const now = Date.now();

        // Update room video state
        switch (action) {
            case 'play':
                room.videoState.isPlaying = true;
                room.videoState.currentTime = time;
                room.videoState.lastUpdate = now;
                break;
            case 'pause':
                room.videoState.isPlaying = false;
                room.videoState.currentTime = time;
                room.videoState.lastUpdate = now;
                break;
            case 'seek':
                room.videoState.currentTime = time;
                room.videoState.lastUpdate = now;
                break;
        }

        // Broadcast to all other users in the room
        socket.to(roomName).emit('sync-video', {
            action: action,
            time: time,
            timestamp: now,
            from: socket.userName
        });

        console.log(`${socket.userName} performed ${action} at ${time}s in room ${roomName}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.roomName && rooms.has(socket.roomName)) {
            const room = rooms.get(socket.roomName);
            room.participants.delete(socket.id);
            
            // Notify others in the room
            socket.to(socket.roomName).emit('user-left', {
                userName: socket.userName,
                participants: Array.from(room.participants.values())
            });

            // Clean up empty rooms
            if (room.participants.size === 0) {
                rooms.delete(socket.roomName);
                console.log(`Room ${socket.roomName} deleted (empty)`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Make sure to place your video file at: public/sample-video.mp4`);
});