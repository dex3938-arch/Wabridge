// Server-Sent Events hub: pushes live updates (new messages, session status, campaign progress)
// to every signed-in dashboard tab.
const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
  const client = { res, userId: req.user.id };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  // `res` closes when the browser goes away (req 'close' fires as soon as the GET body is read).
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
