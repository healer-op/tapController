const net = require('net');

function findFreePort(preferred = 7777) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(findFreePort(preferred + 1)));
    server.once('listening', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.listen(preferred, '0.0.0.0');
  });
}

module.exports = { findFreePort };
