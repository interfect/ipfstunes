# IPFSTunes

IPFStunes is an in-browser muisic player backended by IPFS. It runs IPFS in the browser and communicates over websockets.

To run, open `index.html` in the `app` folder, or serve it locally on [http://localhost:8080/](http://localhost:8080/) with `npm install -g http-server` and then `http-server` from within `app`.

You will probably need a libp2p-webrtc-star signaling server, which you can get with an `npm install -g libp2p-webrtc-star`. After that, running `star-sig` or maybe `node $(which star-sig)` will start one up.

# Deploying to Github Pages

To deploy ipfstunes onto Guthub Pages, do a subtree push of the `app` folder to the `gh-pages` branch:

```
git subtree push --prefix app origin gh-pages
```

