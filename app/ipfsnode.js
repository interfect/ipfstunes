// Provides an IpfsNode that can be started with .start() and exposes a working
// IPFS instance as .ipfs. Handles all of the startup and peer management stuff.
// Auto-finds its IPFS module dependency.
var IpfsNode = (function () {

  // Find the IPFS implementation
  var IPFS
  if(!(typeof require === 'undefined')) {
    // Can load through Node
    IPFS = require('ipfs')
  } else if(!(typeof Ipfs === 'undefined')) {
    // Can load through browser global
    IPFS = Ipfs
  }

  // Make the object we will export as our singleton IPFS node manager thingy.
  var ipfsnode = {
    // This provides the actual IPFS interface: ipfs.files.add(), etc.
    ipfs: new IPFS()
  }

  // Utility function. Init a repo in the given IPFS node it if hasn't got one
  // already. Calls the setup callback, passing the normal callback, after first
  // initialization. Calls the normal callback directly after subsequent
  // initializations. Calls the normal callback with an error parameter if there
  // is an error.
  function initIfNeeded (ipfs, setup, callback) {
    ipfs.init((err) => {
      if (!err) {
        // This is the first time we have started a node
        setup(callback)
      } else if (err.message == 'repo already exists') {
        // The node already exists
        callback()
      } else {
        callback(err)
      }
    })
  }
  
  /**
   * Start up the node, and call the given callback with no argument when it is
   * online. If an error is encountered, call the callback with the error
   * instead.
   */
  ipfsnode.start = function (ipfsOnlineCallback) {

    // Init the node
    initIfNeeded(this.ipfs, (callback) => {
      // On first initialization, do some setup
      // Get the node config we just init-ed
      this.ipfs.config.get((err, config) => {
        if (err) {
          ipfsOnlineCallback(err)
          return
        }
        // Add at least one libp2p-webrtc-star address. Without an address like
        // this the libp2p-webrtc-star transport won't be installed, and the
        // resulting node won't be able to dial out to libp2p-webrtc-star
        // addresses.
        var starAddr = ('/libp2p-webrtc-star/ip4/10.1.0.10/tcp/9090/ws/ipfs/' +
          config.Identity.PeerID)
        this.ipfs.config.set('Addresses.Swarm[1]', starAddr, (err) => {
          if (err) {
            ipfsOnlineCallback(err)
            return
          }
          // Continue down the already-initialized code path
          callback()
        })
      })
    }, (err) => {
      // If the repo was already initialized, or after the first-time
      // initialization code is run, we'll do this.
      if (err) {
        ipfsOnlineCallback(err)
        return
      }
      // Have the node set itself up
      this.ipfs.load(() => {
        // Go online and connect to things
        this.ipfs.goOnline(() => {
          if(this.ipfs.isOnline()) {
            // We went online successfully. Call the callback that the module
            // consumer gave us.
            ipfsOnlineCallback()
          } else {
            ipfsOnlineCallback(Error("IPFS did not come online"))
          }
        })
      })
    })
  }
  
  /**
   * Download all of a file and call the callback with null and a single
   * complete buffer. If an error occurs, call the callback with the error.
   */
  ipfsnode.catAll = function (hash, callback) {
  
    // Go get the file
    ipfsnode.ipfs.files.cat(hash, (err, contentStream) => {
      if (err) {
        // Forward errors
        callback(err)
      }
      
      // We're going to batch up all the buffers and make one big buffer.
      var buffersObtained = []
      
      contentStream.on('data', (buffer) => {
        // Handle incoming data from IPFS
      
        // Stick all the buffers we get from IPFS into the list
        if(buffer.length > 0) {
          // Don't pass through 0 length buffers.
          console.log('Got data from IPFS: %d bytes', buffer.length)
          buffersObtained.push(buffer)
        }
      })
      
      contentStream.on('error', (err) => {
        // There might be errors on the stream maybe?
        // TODO: does this throw errors?
        callback(err)
      })
      
      contentStream.on('end', () => {
        // We got the whole thing. Send it along.
        callback(null, ipfsnode.ipfs.Buffer.concat(buffersObtained))
      })
    })
    
    // TODO: timeouts or something for when we can't fetch a file quickly.
    
  }
  
  // Return the completed module object, with start method and ipfs field
  return ipfsnode
}())
