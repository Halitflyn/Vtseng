import React, { useEffect, useState, useRef, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { Github, LogOut, Send, Users, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types
interface User {
  id: number;
  username: string;
  avatar_url: string;
}

interface Message {
  id: number;
  content: string;
  created_at: string;
  username: string;
  avatar_url: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('github_chat_token'));
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Fetch user profile if token exists
  useEffect(() => {
    const fetchUser = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/user', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
        } else {
          setToken(null);
          localStorage.removeItem('github_chat_token');
        }
      } catch (err) {
        console.error('Failed to fetch user', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUser();
  }, [token]);

  // Handle OAuth callback
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        const newToken = event.data.token;
        setToken(newToken);
        localStorage.setItem('github_chat_token', newToken);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Socket connection
  useEffect(() => {
    if (!user || !token) return;

    const newSocket = io({
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Connected to socket server');
    });

    newSocket.on('message:new', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('users:online', (users: User[]) => {
      setOnlineUsers(users);
    });

    setSocket(newSocket);

    // Fetch initial messages
    fetch('/api/messages')
      .then(res => res.json())
      .then(data => setMessages(data))
      .catch(err => console.error('Failed to fetch messages', err));

    return () => {
      newSocket.disconnect();
    };
  }, [user, token]);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      window.open(data.url, 'github_oauth', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get auth URL', err);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('github_chat_token');
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;
    
    socket.emit('message:send', newMessage);
    setNewMessage('');
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl"
        >
          <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Github className="w-8 h-8 text-zinc-100" />
          </div>
          <h1 className="text-3xl font-bold text-zinc-100 mb-2 tracking-tight">GitHub Chat</h1>
          <p className="text-zinc-400 mb-8">Connect with developers worldwide in real-time.</p>
          
          <button
            onClick={handleLogin}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-900/20"
          >
            <Github className="w-5 h-5" />
            Continue with GitHub
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-lg tracking-tight">
            <MessageSquare className="w-5 h-5 text-emerald-500" />
            <span>DevChat</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Online Users ({onlineUsers.length})
          </div>
          <div className="space-y-2">
            <AnimatePresence>
              {onlineUsers.map(u => (
                <motion.div 
                  key={u.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="relative">
                    <img src={u.avatar_url} alt={u.username} className="w-8 h-8 rounded-full border border-zinc-700" />
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-zinc-900"></div>
                  </div>
                  <span className="text-sm font-medium truncate">{u.username}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3 mb-4">
            <img src={user.avatar_url} alt={user.username} className="w-10 h-10 rounded-full border border-zinc-700" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user.username}</div>
              <div className="text-xs text-zinc-500">Online</div>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* Mobile Header */}
        <div className="md:hidden p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
          <div className="flex items-center gap-2 font-semibold">
            <MessageSquare className="w-5 h-5 text-emerald-500" />
            <span>DevChat</span>
          </div>
          <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-zinc-100">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, idx) => {
            const isMe = msg.username === user.username;
            const showAvatar = idx === 0 || messages[idx - 1].username !== msg.username;
            
            return (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={msg.id} 
                className={`flex gap-4 ${isMe ? 'flex-row-reverse' : ''}`}
              >
                <div className="flex-shrink-0 w-10">
                  {showAvatar && (
                    <img 
                      src={msg.avatar_url} 
                      alt={msg.username} 
                      className="w-10 h-10 rounded-full border border-zinc-800"
                    />
                  )}
                </div>
                <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                  {showAvatar && (
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium text-zinc-300">{msg.username}</span>
                      <span className="text-xs text-zinc-600">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                    isMe 
                      ? 'bg-emerald-600 text-white rounded-tr-sm' 
                      : 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-zinc-950 border-t border-zinc-800">
          <form onSubmit={sendMessage} className="max-w-4xl mx-auto relative">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message the room..."
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder:text-zinc-600"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-emerald-500 hover:text-emerald-400 disabled:text-zinc-600 disabled:hover:text-zinc-600 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
