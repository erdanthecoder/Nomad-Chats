const { v4: uuid } = require('uuid');
const db = require('./db');

const BOT_USERNAME = 'nomadbot';
const BOT_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="botBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b7ff5"/>
      <stop offset="100%" stop-color="#5645c9"/>
    </linearGradient>
    <radialGradient id="botGloss" cx="30%" cy="18%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" rx="24" fill="url(#botBg)"/>
  <rect x="0" y="0" width="100" height="100" rx="24" fill="url(#botGloss)"/>
  <line x1="50" y1="16" x2="50" y2="26" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
  <circle cx="50" cy="13" r="5.5" fill="#ffffff"/>
  <rect x="24" y="28" width="52" height="46" rx="18" fill="#ffffff"/>
  <circle cx="40" cy="50" r="6.5" fill="#5645c9"/>
  <circle cx="60" cy="50" r="6.5" fill="#5645c9"/>
  <path d="M38 63 q12 9 24 0" stroke="#5645c9" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  <rect x="14" y="44" width="8" height="16" rx="4" fill="#ffffff" opacity="0.9"/>
  <rect x="78" y="44" width="8" height="16" rx="4" fill="#ffffff" opacity="0.9"/>
</svg>`
)}`;

let botUserId = null;

function ensureBotUser() {
  if (botUserId) return botUserId;
  let bot = db.prepare('SELECT id FROM users WHERE username = ?').get(BOT_USERNAME);
  if (!bot) {
    const id = uuid();
    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, avatar_url, status_text, language, is_bot, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'en', 1, NULL, ?)`
    ).run(id, BOT_USERNAME, 'not-a-real-account', 'Nomad Bot', BOT_AVATAR, 'Ask me for /help — dice, coin flips, rock-paper-scissors and more.', now);
    bot = { id };
  }
  botUserId = bot.id;
  return botUserId;
}

function ensureBotConversation(userId) {
  const botId = ensureBotUser();
  const existing = db.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
     WHERE c.type = 'direct'`
  ).get(userId, botId);
  if (existing) return existing.id;

  const id = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO conversations (id, type, name, avatar_url, created_by, created_at) VALUES (?, 'direct', NULL, NULL, ?, ?)`)
    .run(id, botId, now);
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
    .run(id, userId, now);
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
    .run(id, botId, now);
  return id;
}

function isBotConversation(conversationId) {
  const botId = ensureBotUser();
  const row = db.prepare(
    `SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`
  ).get(conversationId, botId);
  return !!row;
}

// ---- Mini-games: per-conversation state, in-memory (resets on restart, which is fine for a fun side feature) ----
const guessSessions = new Map(); // conversationId -> { target, attempts }

const RPS_CHOICES = {
  en: { rock: 'rock', paper: 'paper', scissors: 'scissors' },
  ru: { 'камень': 'rock', 'бумага': 'paper', 'ножницы': 'scissors' }
};

const TEXT = {
  en: {
    welcome: `Hi, I'm Nomad Bot! I'm your built-in assistant. Type /help to see what I can do.`,
    help: `Here's what I can do:\n\n/dice — roll a die\n/flip — flip a coin\n/rps rock|paper|scissors — play against me\n/guess — I'll think of a number 1-100, you guess it\n/joke — tell you a joke\n/help — show this again`,
    unknown: `I didn't quite catch that. Type /help to see what I can do.`,
    rpsUsage: `Play with: /rps rock, /rps paper, or /rps scissors`,
    guessStart: `I'm thinking of a number between 1 and 100. Reply with a number to guess!`,
    guessNoActiveGame: `No game in progress — type /guess to start one!`,
    guessHigher: (n) => `${n} is too low. Try higher!`,
    guessLower: (n) => `${n} is too high. Try lower!`,
    guessWin: (n, attempts) => `🎉 That's it — ${n} in ${attempts} guess${attempts === 1 ? '' : 'es'}! Type /guess to play again.`,
    jokes: [
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "I told my computer I needed a break, and it froze.",
      "Why did the developer go broke? Because they used up all their cache.",
      "There are 10 types of people: those who understand binary, and those who don't."
    ]
  },
  ru: {
    welcome: `Привет, я Nomad Bot! Я встроенный ассистент. Напишите /help, чтобы узнать, что я умею.`,
    help: `Вот что я умею:\n\n/dice — бросить кубик\n/flip — подбросить монетку\n/rps камень|бумага|ножницы — сыграть со мной\n/guess — я загадаю число от 1 до 100, а вы угадаете\n/joke — рассказать шутку\n/help — показать это снова`,
    unknown: `Не совсем понял. Напишите /help, чтобы узнать, что я умею.`,
    rpsUsage: `Играйте так: /rps камень, /rps бумага или /rps ножницы`,
    guessStart: `Я загадал число от 1 до 100. Напишите число, чтобы угадать!`,
    guessNoActiveGame: `Игра не начата — напишите /guess, чтобы начать!`,
    guessHigher: (n) => `${n} — слишком мало. Попробуйте больше!`,
    guessLower: (n) => `${n} — слишком много. Попробуйте меньше!`,
    guessWin: (n, attempts) => `🎉 Точно — ${n} за ${attempts} попыт${attempts === 1 ? 'ку' : 'ки'}! Напишите /guess, чтобы сыграть снова.`,
    jokes: [
      "Почему программисты путают Хэллоуин и Рождество? Потому что OCT 31 == DEC 25.",
      "Я сказал компьютеру, что мне нужен перерыв — и он завис.",
      "Сколько программистов нужно, чтобы поменять лампочку? Ни одного — это аппаратная проблема.",
      "Есть 10 типов людей: те, кто понимает двоичный код, и те, кто нет."
    ]
  }
};

function insertMessage(conversationId, senderId, type, fields) {
  const id = uuid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, type, content, file_url, file_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, senderId, type, fields.content || null, fields.fileUrl || null, fields.fileName || null, now);
  return {
    id, conversationId, senderId, type,
    content: fields.content || null, fileUrl: fields.fileUrl || null, fileName: fields.fileName || null,
    createdAt: now
  };
}

// Returns an array of message objects (already persisted) to broadcast as the bot's reply.
function handleBotMessage(conversationId, userText, lang) {
  const t = TEXT[lang] || TEXT.en;
  const botId = ensureBotUser();
  const text = String(userText || '').trim();
  const lower = text.toLowerCase();
  const reply = (content) => insertMessage(conversationId, botId, 'text', { content });
  const game = (payload) => insertMessage(conversationId, botId, 'game', { content: JSON.stringify(payload) });

  if (lower === '/start') return [reply(t.welcome)];
  if (lower === '/help') return [reply(t.help)];

  if (lower === '/dice' || lower === '/roll') {
    const value = 1 + Math.floor(Math.random() * 6);
    return [game({ kind: 'dice', value })];
  }

  if (lower === '/flip' || lower === '/coin') {
    const value = Math.random() < 0.5 ? 'heads' : 'tails';
    return [game({ kind: 'coin', value })];
  }

  if (lower.startsWith('/rps')) {
    const arg = lower.replace('/rps', '').trim();
    const map = RPS_CHOICES[lang] || RPS_CHOICES.en;
    const you = map[arg] || RPS_CHOICES.en[arg];
    if (!you) return [reply(t.rpsUsage)];
    const options = ['rock', 'paper', 'scissors'];
    const bot = options[Math.floor(Math.random() * 3)];
    let result;
    if (you === bot) result = 'draw';
    else if (
      (you === 'rock' && bot === 'scissors') ||
      (you === 'paper' && bot === 'rock') ||
      (you === 'scissors' && bot === 'paper')
    ) result = 'win';
    else result = 'lose';
    return [game({ kind: 'rps', you, bot, result })];
  }

  if (lower === '/guess') {
    guessSessions.set(conversationId, { target: 1 + Math.floor(Math.random() * 100), attempts: 0 });
    return [reply(t.guessStart)];
  }

  if (/^\d+$/.test(text)) {
    if (!guessSessions.has(conversationId)) return [reply(t.guessNoActiveGame)];
    const session = guessSessions.get(conversationId);
    const n = Number(text);
    session.attempts += 1;
    if (n === session.target) {
      guessSessions.delete(conversationId);
      return [game({ kind: 'guess-win', value: n, attempts: session.attempts })];
    }
    return [reply(n < session.target ? t.guessHigher(n) : t.guessLower(n))];
  }

  if (lower === '/joke') {
    return [reply(t.jokes[Math.floor(Math.random() * t.jokes.length)])];
  }

  return [reply(t.unknown)];
}

module.exports = { ensureBotUser, ensureBotConversation, isBotConversation, handleBotMessage, get botUserId() { return botUserId; } };
