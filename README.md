# IPFSTunes

IPFStunes is an in-browser muisic player backended by IPFS. It runs IPFS in the browser and communicates over websockets.

To build, get all the dependencies and dev dependencies with Node, and run `aegir-build`. The built JS for the browser ends up in `dist`, with the right parts swapped out for browser use thanks to the `.aegir.conf` taken from `js-ipfs`. Then the `index.html` in the main repo root will load it up.

You will probably need a libp2p-webrtc-star signaling server, which you can get with an `npm install -g libp2p-webrtc-star`. After that, running `star-sig` or maybe `node $(which star-sig)` will start one up.

