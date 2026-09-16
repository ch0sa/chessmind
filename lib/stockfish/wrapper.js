importScripts('stockfish.js');

let engineInstance = null;

Stockfish().then((engine) => {
  engineInstance = engine;
  engine.addMessageListener((line) => {
    postMessage(line);
  });
});

self.onmessage = function(e) {
  if (engineInstance) {
    engineInstance.postMessage(e.data);
  } else {
    const tryPost = () => {
      if (engineInstance) {
        engineInstance.postMessage(e.data);
      } else {
        setTimeout(tryPost, 50);
      }
    };
    tryPost();
  }
};
