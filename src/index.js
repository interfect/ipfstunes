// main.js: main entry point for the app

// Global setup

// Make an IPFS node
var IPFS = require('ipfs')

// If true, make a temporary/randomly-named IPFS node
var temp = false;

var randID = Math.floor((Math.random() * 100000) + 1)

var node = new IPFS(temp ? ("tempnode" + randID) : undefined)

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
        console.log("Config: ", config)
        console.log("Error: ", err)
        
        if (err) {
            throw err
        }

        // We don't get webrtc unless we stick some webrtc addresses in the peer info.
        // Like /libp2p-webrtc-star/ip4/127.0.0.1/tcp/9090/ws/ipfs/QmcgpsyWgH8Y8ajJz1Cu72KnS5uo2Aa2LpzU7kinSoooo1
        // Or   /libp2p-webrtc-star/ip4/10.1.0.1/tcp/9090/ws/ipfs/QmcgpsyWgH8Y8ajJz1Cu72KnS5uo2Aa2LpzU7kinSoooo1
        
        // Points to a signaling server we talk to and then our IPFS hash
        // Server is in <https://github.com/libp2p/js-libp2p-webrtc-star>
        
        // But we're going to need our node's IPFS identity to construct the address.
        // Which is in config.Identity.PeerId
        
        console.log("Node ID: ", config.Identity.PeerID)
        
        // Make a valid address including our IPFS ID. Unless we have *one*
        // of these, the libp2p-webrtc-star transport won't be initialized,
        // and then we won't be able to dial out on it to *any* signaling
        // server.
        var webrtc_star_addr = "/libp2p-webrtc-star/ip4/10.1.0.2/tcp/9090/ws/ipfs/" + config.Identity.PeerID
    
        // For now we use a local signaling server
        node.config.set("Addresses.Swarm[1]", webrtc_star_addr, (err) => {

            console.log(err)
            
            if (err) {
                throw err
            }


            // Load up the node again now that the addrs are ready.
            // It should get the addrs we need.
            node.load(() => {
            
                console.log("Loaded")
                
                // Add a bootstrap peer so we connect to the signaling server and actually look for peers there.
                node.bootstrap.add("/libp2p-webrtc-star/ip4/10.1.0.2/tcp/9090/ws/ipfs/QmNQL65n2gcRBmLSfRzEQ5VvBu7cueaic5SLX65AH4GFCP", () => {

                    // Go online and connect to things
                    node.goOnline(() => {
                        console.log(node.isOnline())

                        //node.swarm.connect("/libp2p-webrtc-star/ip4/10.1.0.2/tcp/9090/ws/ipfs/QmcgpsyWgH8Y8ajJz1Cu72KnS5uo2Aa2LpzU7kinSoooo1", console.log)

                        node.swarm.peers((err, peers) => {
                            peers.forEach((multiaddr) => {
                                console.log(multiaddr.toString())
                            })
                        })

                    })
                })
            })
            
        })
    })

})
