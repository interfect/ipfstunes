// main.js: main entry point for the app

// Global setup

// Make an IPFS node
var IPFS = require('ipfs')

var node = new IPFS()

console.log(node)

window.node = node

// Start it up as in https://github.com/ipfs/js-ipfs/blob/c8dbf6ba16017103b29589bb6d4173f954b4325f/src/http-api/index.js

// Init a repo in the given IPFS node it if hasn't got one already, then call
// the callback.
function initIfNeeded(node, callback) {
    node.init((err) => {
        if(!err) {
            console.log("Initialized new repo")
        }
        
        // Ignore already exists type errors and just run the callback.
        callback()
    })
}

// Init the node before loading
initIfNeeded(node, () => {

    console.log("Ready to get config")

    // Get the node config we just init-ed
    node.config.get((err, config) => {
        console.log(config)
        console.log(err)
        
        if (err) {
            throw err
        }

        // We don't get webrtc unless we stick some webrtc addresses in the peer info.
        // Like /libp2p-webrtc-star/ip4/127.0.0.1/tcp/9090/ws/ipfs/QmcgpsyWgH8Y8ajJz1Cu72KnS5uo2Aa2LpzU7kinSoooo1
        
        // Points to a signaling server we talk to and then our IPFS hash
        // Server is in <https://github.com/libp2p/js-libp2p-webrtc-star>
        
        // For now we use a local signaling server
        node.config.set("Addresses.Swarm[1]", "/libp2p-webrtc-star/ip4/127.0.0.1/tcp/9090/ws", (err) => {

            console.log(err)
            
            if (err) {
                throw err
            }


            // Load up the node now that the addrs are ready
            node.load(() => {
            
                console.log("Loaded")

                // Go online and connect to things
                node.goOnline(() => {
                      console.log(node.isOnline())
                })
            })
        })
    })

})
