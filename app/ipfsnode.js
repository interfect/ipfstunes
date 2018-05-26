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
  var ipfsnode = {}
  if (window.ipfs) {
    console.log('Using built-in browser IPFS support')
    ipfsnode.ipfs = window.ipfs
    
    // Node is already started, so start function can be an immediate callback
    ipfsnode.start = function (ipfsOnlineCallback) {
      ipfsOnlineCallback()
    }
    
    // Find the buffer implementation
    ipfsnode.Buffer = window.Buffer
    
    // TODO: Adding files with in-browser js-ipfs is *extremely* slow and hangs the browser UI for like a minute
  } else {
    console.log('Using ipfs-js fallback')
    ipfsnode.ipfs = new IPFS()
    
    /**
     * Start up the node, and call the given callback with no argument when it is
     * online. If an error is encountered, call the callback with the error
     * instead.
     */
    ipfsnode.start = function (ipfsOnlineCallback) {
      ipfsnode.ipfs.on('error', ipfsOnlineCallback)
      ipfsnode.ipfs.on('ready', ipfsOnlineCallback)
    }
    
    // Find the buffer implementation
    ipfsnode.Buffer = ipfsnode.ipfs.types.Buffer
  }
  // ipfsnode.ipfs provides ipfs.files.add(), etc.

  
  
  
  
  
  // Return the completed module object, with start method and ipfs field
  return ipfsnode
}())
