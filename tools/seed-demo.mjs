// Fills a SEPARATE demo WaBridge database with realistic sample data for marketing screenshots.
// Usage: node tools/seed-demo.mjs <path-to-demo-data-dir>   (the demo server must have created its schema)
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dir = process.argv[2];
const db = new DatabaseSync(path.join(dir, 'wabridge.sqlite'));
const run = (sql, ...p) => db.prepare(sql).run(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
const scrypt = (pw) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};

db.exec('BEGIN');
// team
for (const [name, email, role] of [
  ['Ananya Rao', 'ananya@greenleaf.demo', 'agent'],
  ['Imran Khan', 'imran@greenleaf.demo', 'agent'],
]) {
  if (!get('SELECT 1 FROM users WHERE email = ?', email)) run("INSERT INTO users(name, email, password_hash, role, last_login) VALUES(?, ?, ?, ?, ?)", name, email, scrypt(crypto.randomUUID()), role, iso(30));
}
const ananya = get("SELECT id FROM users WHERE email = 'ananya@greenleaf.demo'").id;
const imran = get("SELECT id FROM users WHERE email = 'imran@greenleaf.demo'").id;
run(`INSERT INTO settings(key, value) VALUES('general', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ businessName: 'GreenLeaf Store', timezone: 'Asia/Kolkata', defaultCountryCode: '91' }));
run("INSERT OR IGNORE INTO numbers(session_id, label, warmup_started_at, daily_limit) VALUES('demo-sales', 'Sales', ?, 300)", iso(9 * 1440));
run("INSERT OR IGNORE INTO numbers(session_id, label, warmup_started_at, daily_limit) VALUES('demo-support', 'Support', ?, 400)", iso(23 * 1440));

// contacts
const first = ['Priya', 'Rahul', 'Anjali', 'Mohit', 'Sneha', 'Arjun', 'Kavya', 'Vikram', 'Neha', 'Rohan', 'Isha', 'Karan', 'Pooja', 'Aditya', 'Meera', 'Siddharth', 'Tanvi', 'Nikhil', 'Riya', 'Harsh', 'Divya', 'Aman', 'Shreya', 'Varun', 'Nisha', 'Yash', 'Kriti', 'Manish', 'Aisha', 'Dev', 'Simran', 'Gaurav', 'Ira', 'Kabir', 'Lavanya', 'Om', 'Zoya', 'Parth', 'Ritu', 'Sahil'];
const last = ['Sharma', 'Verma', 'Mehta', 'Gupta', 'Iyer', 'Nair', 'Reddy', 'Singh', 'Kapoor', 'Joshi', 'Bose', 'Malhotra', 'Patel', 'Chopra', 'Rao', 'Das', 'Kulkarni', 'Agarwal', 'Sinha', 'Bhat'];
const tagsFor = (i) => [i % 3 === 0 ? 'vip' : 'customer', i % 2 ? 'diwali-2026' : 'new-arrivals', ['delhi', 'mumbai', 'pune', 'bengaluru'][i % 4]];
const phoneOf = (i) => {
  const h = crypto.createHash('md5').update(`demo-${i}`).digest('hex');
  return `91${['98', '97', '99', '88', '70', '63', '81', '90'][i % 8]}${String(parseInt(h.slice(0, 10), 16)).slice(-8)}`;
};
first.forEach((f, i) => {
  const phone = phoneOf(i);
  run('INSERT OR IGNORE INTO contacts(phone, name, tags, opted_in, opted_out, on_whatsapp, source, created_at) VALUES(?, ?, ?, ?, ?, 1, ?, ?)', phone, `${f} ${last[i % last.length]}`, JSON.stringify(tagsFor(i)), i === 6 ? 0 : 1, i === 6 ? 1 : 0, i % 4 ? 'import' : 'whatsapp', iso(20 * 1440 - i * 300));
});

// conversations with messages
function conv(i, session, status, assigned, msgs, unread = 0) {
  const phone = phoneOf(i);
  const name = get('SELECT name FROM contacts WHERE phone = ?', phone).name;
  run('INSERT OR IGNORE INTO conversations(channel, session_id, chat_id, phone, name, status, assigned_to, backfilled, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?)', 'openwa', session, `${phone}@c.us`, phone, name, status, assigned, iso(3000));
  const c = get('SELECT id FROM conversations WHERE session_id = ? AND chat_id = ?', session, `${phone}@c.us`);
  let last;
  for (const [mins, dir, body, author, st] of msgs) {
    run('INSERT INTO messages(conversation_id, wa_id, direction, type, body, status, author, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', c.id, `demo_${crypto.randomUUID()}`, dir, 'text', body, st || (dir === 'in' ? 'received' : 'read'), author || null, iso(mins));
    last = [mins, dir, body];
  }
  run('UPDATE conversations SET last_message = ?, last_direction = ?, last_at = ?, last_inbound_at = ?, unread = ? WHERE id = ?', last[2], last[1], iso(last[0]), iso(msgs.filter((m) => m[1] === 'in').slice(-1)[0]?.[0] ?? last[0]), unread, c.id);
  return c.id;
}

const priya = conv(0, 'demo-sales', 'open', ananya, [
  [21, 'in', 'Hi! Is the mint chikankari kurta set available in size M? 😊'],
  [21, 'out', 'Hi Priya 👋 Thanks for messaging GreenLeaf Store! How can we help you today?', 'bot'],
  [19, 'out', 'Yes, size M is in stock in mint and in ivory. Shall I keep one aside for you?', 'agent'],
  [17, 'in', 'Mint please! What is the price?'],
  [16, 'out', 'The mint kurta set with dupatta is ₹1,499. Delivery is free above ₹999 and you can exchange within 7 days 🙂', 'ai'],
  [13, 'in', 'Perfect. Can I pick it up from your Lajpat Nagar store this evening?'],
  [11, 'out', 'Of course! We are open till 8:30 pm today. I have reserved it under your name — Priya S. 🛍️', 'agent'],
  [2, 'in', 'Thank you so much! See you at 7 😊'],
], 1);
conv(1, 'demo-support', 'open', imran, [
  [130, 'in', 'Order #4521 kab tak deliver hoga?'],
  [129, 'out', 'Hi Rahul! Order #4521 was shipped yesterday via Delhivery and should reach you by Friday. You will get the tracking link on SMS.', 'ai'],
  [12, 'in', 'Great, thanks 👍'],
]);
conv(2, 'demo-support', 'pending', null, [
  [70, 'in', 'Can I exchange a dupatta I bought last week? The colour is a bit different from the photo.'],
  [69, 'out', 'Sure — exchanges are free within 7 days. Connecting you with our team to arrange a pickup 🙏', 'bot'],
  [20, 'in', 'Okay, waiting for your call'],
], 1);
conv(3, 'demo-sales', 'open', null, [
  [33, 'in', 'Is the Diwali offer still valid on sarees?'],
  [32, 'out', 'Yes! 20% off on all sarees till Sunday. Reply with the saree code and we will share photos 🪔', 'bot'],
  [9, 'in', 'SR-118 and SR-122 please'],
], 2);
conv(4, 'demo-sales', 'open', ananya, [
  [240, 'in', 'Payment done ✅ UPI ref 3365 1189 0042'],
  [236, 'out', 'Received, thank you Sneha! Your order is being packed and will ship today.', 'agent'],
]);
conv(5, 'demo-support', 'open', null, [
  [600, 'in', 'What are your store timings on Sunday?'],
  [599, 'out', 'We are closed right now 🌙 Sunday timings are 11 am – 7 pm. We will reply first thing when we open.', 'bot'],
]);
conv(6, 'demo-sales', 'closed', null, [
  [900, 'out', 'Hi Kavya 👋 Our Diwali collection is live — 20% off till Sunday. Reply STOP to unsubscribe.', 'campaign'],
  [880, 'in', 'STOP'],
  [879, 'out', 'You have been unsubscribed. Reply START to subscribe again.', 'bot'],
]);
conv(7, 'demo-sales', 'open', imran, [
  [15, 'in', 'Do you ship to Pune? Want 3 kurtis for my sisters 😄'],
  [14, 'out', 'Yes, we ship all over India in 3–5 days. Here are this week’s bestsellers 👇', 'agent'],
]);

// 14 days of history (closed chats) for the overview chart
for (let d = 13; d >= 1; d--) {
  const n = 18 + ((d * 37) % 23);
  for (let k = 0; k < n; k++) {
    const i = 8 + ((d * 5 + k) % 30);
    const session = k % 2 ? 'demo-sales' : 'demo-support';
    run("INSERT OR IGNORE INTO conversations(channel, session_id, chat_id, phone, name, status, backfilled, last_at, last_message, last_direction) VALUES('openwa', ?, ?, ?, ?, 'closed', 1, ?, 'Thank you!', 'in')", session, `${phoneOf(i)}@c.us`, phoneOf(i), get('SELECT name FROM contacts WHERE phone = ?', phoneOf(i)).name, iso(d * 1440 + 60));
    const c = get('SELECT id FROM conversations WHERE session_id = ? AND chat_id = ?', session, `${phoneOf(i)}@c.us`);
    run("INSERT INTO messages(conversation_id, direction, body, status, created_at) VALUES(?, 'in', 'Hi, is this available?', 'received', ?)", c.id, iso(d * 1440 + 200 + k * 9));
    run("INSERT INTO messages(conversation_id, direction, body, status, author, created_at) VALUES(?, 'out', 'Yes it is! Sharing details now.', 'read', ?, ?)", c.id, k % 3 ? 'agent' : 'ai', iso(d * 1440 + 196 + k * 9));
    if (k % 2) run("INSERT INTO messages(conversation_id, direction, body, status, author, created_at) VALUES(?, 'out', 'Our Diwali collection is live!', 'delivered', 'campaign', ?)", c.id, iso(d * 1440 + 400 + k * 7));
  }
}
// today's extra volume
for (let k = 0; k < 26; k++) {
  const i = 8 + (k % 30);
  const c = get("SELECT id FROM conversations WHERE chat_id = ? LIMIT 1", `${phoneOf(i)}@c.us`);
  if (c) run("INSERT INTO messages(conversation_id, direction, body, status, author, created_at) VALUES(?, ?, 'Thanks!', ?, ?, ?)", c.id, k % 3 ? 'out' : 'in', k % 3 ? 'read' : 'received', k % 3 ? (k % 2 ? 'campaign' : 'bot') : null, iso(30 + k * 11));
}

// templates
for (const [name, body, cat, sc] of [
  ['Greeting', 'Hi {{first_name}} 👋 Thanks for reaching GreenLeaf Store. How can we help you today?', 'general', 'hi'],
  ['Store address', 'We are at 14, Central Market, Lajpat Nagar II, New Delhi. Open 10:30 am – 8:30 pm, Mon–Sat.', 'general', 'address'],
  ['Payment details', 'You can pay by UPI to greenleaf@okaxis or with any card at the store. Please share the UPI reference once done ✅', 'billing', 'pay'],
  ['Order shipped', 'Good news {{first_name}}! Your order is on its way 🚚 Expected delivery: 3–5 days.', 'support', 'shipped'],
]) run('INSERT INTO templates(name, body, category, shortcut) VALUES(?, ?, ?, ?)', name, body, cat, sc);

// automations
for (const [name, trig, kw, rt, body, prio, hits, tag] of [
  ['Welcome message', 'welcome', '', 'text', 'Hi {{first_name}} 👋 Thanks for messaging {{business}}! How can we help you today?', 10, 86, null],
  ['Price enquiry', 'keyword', 'price, rate, cost, kitna, daam', 'text', 'Thanks for asking! Share the product code or a screenshot and we will send the price right away 🙂', 50, 41, 'price-lead'],
  ['Order status (AI)', 'keyword', 'order, delivery, kab tak, tracking', 'ai', '', 40, 57, null],
  ['Away message', 'away', '', 'text', 'We are closed right now 🌙 We will reply first thing when we open.', 20, 23, null],
]) run('INSERT INTO automations(name, trigger_type, match_type, keywords, reply_type, reply_body, priority, hits, last_hit_at, add_tag) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', name, trig, 'contains', kw, rt, body, prio, hits, iso(hits), tag);
run(`INSERT INTO settings(key, value) VALUES('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ enabled: true, model: 'claude-opus-5-5', effort: 'low', knowledge: 'Store: GreenLeaf, Lajpat Nagar, New Delhi\nTimings: 10:30 am – 8:30 pm (Mon–Sat), 11–7 Sunday\nFree delivery above ₹999, 7-day exchange' }));

// campaigns
const audience = JSON.stringify({ tags: ['diwali-2026'], match: 'any' });
run("INSERT INTO campaigns(name, channel, session_id, body, audience, status, min_delay, max_delay, daily_cap, quiet_start, quiet_end, total, sent, failed, skipped, started_at, next_send_at, created_at) VALUES('Diwali festive offer', 'openwa', 'demo-sales', ?, ?, 'running', 25, 70, 150, NULL, NULL, 240, 162, 2, 9, ?, ?, ?)",
  '{Hi|Hello} {{first_name}} 🪔\n\nOur *Diwali collection* is here — 20% off on sarees and kurta sets till Sunday.\n\nReply with a product code for photos.\nReply STOP to unsubscribe.', audience, iso(300), new Date(Date.now() + 38000).toISOString(), iso(320));
const camp = get("SELECT id FROM campaigns WHERE name = 'Diwali festive offer'").id;
for (let i = 0; i < 40; i++) {
  const j = (i + 30) % 40;
  const st = i < 2 ? 'failed' : i === 2 ? 'skipped' : i < 28 ? 'sent' : 'pending';
  const who = i === 2 ? 6 : j;
  run('INSERT OR IGNORE INTO campaign_recipients(campaign_id, phone, name, status, error, sent_at) VALUES(?, ?, ?, ?, ?, ?)', camp, phoneOf(who), get('SELECT name FROM contacts WHERE phone = ?', phoneOf(who)).name, st,
    st === 'failed' ? 'Number is not on WhatsApp' : st === 'skipped' ? 'Opted out' : null, st === 'sent' ? iso(5 + i * 3) : null);
}
run("INSERT INTO campaigns(name, channel, session_id, body, audience, status, total, sent, failed, skipped, started_at, finished_at, created_at) VALUES('New arrivals — October', 'openwa', 'demo-sales', 'Hi {{first_name}}, fresh cotton kurtis just landed 🌿', ?, 'completed', 180, 174, 1, 5, ?, ?, ?)", JSON.stringify({ tags: ['new-arrivals'] }), iso(8 * 1440), iso(7 * 1440), iso(8 * 1440 + 30));
run("INSERT INTO campaigns(name, channel, session_id, body, audience, status, total, sent, failed, skipped, schedule_at, created_at) VALUES('Weekend flash sale', 'openwa', 'demo-sales', 'Weekend only: buy 2 get 1 free 🎉', ?, 'scheduled', 210, 0, 0, 0, ?, ?)", JSON.stringify({ tags: ['vip'] }), new Date(Date.now() + 2 * 86400000).toISOString(), iso(60));

// activity
for (const [mins, level, type, msg] of [
  [1500, 'info', 'apikey.created', 'API key "Website" created'],
  [880, 'info', 'contact.opted_out', 'Kavya Reddy unsubscribed'],
  [140, 'info', 'contacts.import', 'Imported contacts: 128 new, 14 updated, 3 invalid'],
  [61, 'warn', 'handoff', 'Anjali Mehta asked for a human'],
  [26, 'info', 'campaign.started', 'Campaign "Diwali festive offer" started'],
  [3, 'info', 'session.ready', 'Sales (+91 98111 22233) is connected'],
]) run('INSERT INTO activity(type, level, message, created_at) VALUES(?, ?, ?, ?)', type, level, msg, iso(mins));
db.exec('COMMIT');
console.log('demo data ready; Priya conversation id', priya);
