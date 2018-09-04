// Provides an IpfsNode that can be started with .start() and exposes a working
// IPFS instance as .ipfs. Handles all of the startup and peer management stuff.
// Auto-finds its IPFS module dependency.
var IpfsNode = (function () {

  var ipfsnode = {}
  
  // If we decide to use the in-browser implementation, we call this.
  var startFallback = function(ipfsOnlineCallback) {
    console.log('Using ipfs-js fallback')
    
    // Find the IPFS implementation
    var IPFS
    if(!(typeof require === 'undefined')) {
      // Can load through Node
      IPFS = require('ipfs')
    } else if(!(typeof Ipfs === 'undefined')) {
      // Can load through browser global
      IPFS = Ipfs
    } else {
      return ipfsOnlineCallback(new Error('Cannot find IPFS implementation!'))
    }
    
    // Make the IPFS node, using websockets and webrtc as transports.
    ipfsnode.ipfs = new IPFS({
      config: {
        Addresses: {
          Swarm: [
            // Disable webrtc-star because it's still not good.
            // It interferes with peers being found over websocket-star
            //'/dns4/wrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star',
            // TODO: Check these before trying to use them, as any down server can prevent node startup!
            //'/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star',
            '/dns4/ws-star-signal-2.servep2p.com/tcp/443/wss/p2p-websocket-star'
          ]
        }
      }
    })
    
    // Tell the node to fire the callback with an error or when it is ready.
    ipfsnode.ipfs.on('error', ipfsOnlineCallback)
    ipfsnode.ipfs.on('ready', ipfsOnlineCallback)
    
    // Find the buffer implementation for this mode
    ipfsnode.Buffer = ipfsnode.ipfs.types.Buffer
    
    // Periodically dump peers
    setInterval(() => {
      ipfsnode.ipfs.id((err, id) => {
        if (err) {
          throw err
        }
        ipfsnode.ipfs.swarm.peers({}, function(err, peers) {
          if (err) {
            throw err
          }
          console.log('We are IPFS node ' + id.id + ' with ' + peers.length + ' peers')
        })
      })
    }, 60000)
  }
  
  
  ipfsnode.ipfs = {}
  
  /**
   * Start the IPFS node.
   * After this calls back, the module will have an ipfs field holding the actual, running node.
   */
  ipfsnode.start = function(ipfsOnlineCallback) {
    if (window.ipfs) {
      // We maybe have a local IPFS. But we only want to use the go one; the JS one as part of an extension hangs the browser when we do anything hard.
      // So ask the node what it is.
      window.ipfs.id((err, id) => {
        if (err) {
          // Couldn't talk to the window node. Use the fallback
          return startFallback(ipfsOnlineCallback)
        }
        
        // TODO: We will try window.ipfs despite https://github.com/ipfs-shipyard/ipfs-companion/issues/485
        // Hangs appear to occur no matter if it is talking to internal js-ipfs or external go-ipfs.
        // The workaround is to make the user disable window.ipfs. I will leave it like this and hope the extension fixes its bug.
        
        // Otherwise the browser node checks out.
        console.log('Using ' + id.agentVersion + ' via window.ipfs')
        ipfsnode.ipfs = window.ipfs
        
        // We don't need to start the node, since it is started.
        
        // Find the buffer implementation
        ipfsnode.Buffer = window.Buffer
        
        // Say we are started
        return ipfsOnlineCallback(null)
      })
    } else {
      // No window.ipfs at all. Use the fallback.
      return startFallback(ipfsOnlineCallback)
    }
  }

  // Return the completed module object, with start method and ipfs field
  return ipfsnode
}())
