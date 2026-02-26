import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

// Initialize Database
const db = new Database('chat.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    github_id INTEGER UNIQUE,
    username TEXT,
    avatar_url TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  // Setup Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // GitHub OAuth URL
  app.get('/api/auth/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });
    }
    
    // Use the APP_URL from environment, fallback to host header if not set
    const appUrl = process.env.APP_URL || `https://${req.get('host')}`;
    const redirectUri = `${appUrl}/api/auth/github/callback`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user',
    });
    
    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  });

  // GitHub OAuth Callback
  app.get('/api/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send('No code provided');
    }

    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        throw new Error('GitHub credentials not configured');
      }

      // Exchange code for access token
      const tokenResponse = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
        },
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Get user profile
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const profile = userResponse.data;

      // Save or update user in DB
      const stmt = db.prepare(`
        INSERT INTO users (github_id, username, avatar_url) 
        VALUES (?, ?, ?) 
        ON CONFLICT(github_id) DO UPDATE SET 
        username=excluded.username, 
        avatar_url=excluded.avatar_url
        RETURNING id, username, avatar_url
      `);
      
      const user = stmt.get(profile.id, profile.login, profile.avatar_url) as any;

      // Generate JWT
      const token = jwt.sign({ id: user.id, username: user.username, avatar_url: user.avatar_url }, JWT_SECRET, { expiresIn: '7d' });

      // Send response to close popup and notify parent
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: '${token}' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('OAuth error:', error);
      res.status(500).send('Authentication failed');
    }
  });

  // Get current user
  app.get('/api/user', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json(decoded);
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  // Get message history
  app.get('/api/messages', (req, res) => {
    const messages = db.prepare(`
      SELECT m.id, m.content, m.created_at, u.username, u.avatar_url
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at ASC
      LIMIT 100
    `).all();
    res.json(messages);
  });

  // Socket.IO Connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  const onlineUsers = new Map();

  io.on('connection', (socket) => {
    const user = socket.data.user;
    
    // Add to online users
    onlineUsers.set(user.id, user);
    io.emit('users:online', Array.from(onlineUsers.values()));

    socket.on('message:send', (content) => {
      // Save to DB
      const stmt = db.prepare('INSERT INTO messages (user_id, content) VALUES (?, ?) RETURNING id, created_at');
      const result = stmt.get(user.id, content) as any;

      const message = {
        id: result.id,
        content,
        created_at: result.created_at,
        username: user.username,
        avatar_url: user.avatar_url
      };

      // Broadcast
      io.emit('message:new', message);
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(user.id);
      io.emit('users:online', Array.from(onlineUsers.values()));
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
