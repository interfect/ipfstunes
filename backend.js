// Provides a backend that plays songs with AV and mp3.js.
// Expects aurora.js dependency as a module argument.
var Backend = (function (AV) {

  // Make the object we will export as our singleton sound-playing backend thingy.
  var backend = {
    // This gets filled in with an IpfsNode instance that stores and retrieves
    // files.
    ipfsnode: null,
    // This gets filled in with the communication channel to the player
    // frontend.
    ipc: null,
    // This holds the one AV player that is allowed to make noise. Not to be
    // confused with the Player, which is the frontend,
    global_player: null
  }

  /**
   * Start up the backend, using the given IpfsNode singleton to store and
   * retrieve files, and the given IPC-style EventEmitter to communicate with
   * the Player frontend (with .send() and .on()).
   */
  backend.start = function (ipfsnode, ipc) {
    backend.ipfsnode = ipfsnode
    backend.ipc = ipc
    
    backend.ipc.on('player-upload', (event, file_data) => {
      // Handle an ArrayBuffer of file data to upload.
      
      console.log('Backend got:', event, file_data)
      
      // Load metadata and make sure it's audio
      var asset = AV.Asset.fromBuffer(file_data)
      asset.get('metadata', (metadata) => {
        // We got metadata, so it must be real audio
        console.log('Metadata', metadata)
        
        // Add it to IPFS
        var ipfs = backend.ipfsnode.ipfs
        ipfs.files.add(ipfs.Buffer.from(file_data), (err, returned) => {
          if (err) {
            // IPFS didn't like it, so complain
            throw err
          }
          
          console.log('IPFS hash:', returned[0].hash)
          
          // Craft a list of just this song to feed to the player
          var songs = [
            {
              title: metadata.title,
              album: metadata.album,
              artist: metadata.album,
              url: 'ipfs:' + returned[0].hash
            }
          ]
          
          // Send them to the player so it displays them.
          event.sender.send('player-songs', songs)
          
        })
        
      })
        
    })
    
    backend.ipc.on('player-url', (event, url, playNow) => {
      // Play the given URL. Ought to be an ipfs:<hash> URL.
      
      console.log('Loading: %s', url)
      
      if(backend.global_player !== null) {
        // If there's already a One True Player, get rid of it. Only one player
        // will be allowed to replace it, when an IPFS cat finally finishes.
        backend.global_player.stop();
        backend.global_player = null;
      }
      
      // Get the track data from IPFS
      var ipfs = backend.ipfsnode.ipfs
      ipfs.files.cat(url.split(':')[1], (err, content_stream) => {
      
          if (err) throw err
          
          console.log('Playing: %s', url)
          
          // We're going to batch up all the buffers and make one big buffer.
          // Streaming is for wimps.
          var buffers_obtained = []
          
          content_stream.on('data', (buffer) => {
            // Handle incoming data from IPFS
          
            // Stick all the buffers we get from IPFS into the list
            if(buffer.length > 0) {
              // Don't pass through 0 length buffers. The first buffer needs to
              // be long enough to detect the filetype.
              console.log('Got data from IPFS: %d bytes', buffer.length)
              buffers_obtained.push(buffer)
            }
          })
          
          content_stream.on('end', () => {
            if(backend.global_player === null) {
              console.log('All data available.')
              
              // Make the player only when we have all the data
              
              var whole_buffer = ipfs.Buffer.concat(buffers_obtained)
              
              // Make an asset from the buffer
              var asset = AV.Asset.fromBuffer(whole_buffer)
                  
              asset.on('format', (format) => {
                console.log('Format decoded: ' + format)
              })
              
              asset.on('duration', (duration) => {
                console.log('Duration decoded: %d', duration)
                // Inform the UI of the song duration
                event.sender.send('player-duration', duration)
              })
              
              asset.on('decodeStart', () => {
                console.log('Audio decode started')
              })
              
              // Make a new Player for the asset.
              var player = new AV.Player(asset)
              
              // Become the One True Player
              backend.global_player = player;
              
              player.on('error', (err) => {
                console.log('Player Error: ' + err)
                throw err
              })
              
              player.on('progress', (msecs) => {
                // Inform the UI of the playback progress
                event.sender.send('player-progress', msecs)
              })
              
              player.on('end', () => {
                // We're done!
                console.log('player is done')
                event.sender.send('player-ended')
              })
              
              if(playNow) {
                console.log('Will play now')
                asset.on('duration', () => {
                  if(backend.global_player === player) {
                    // Play only if instructed, and only after duration has been
                    // decoded (and we have the audio data ready to hand), *and*
                    // only if we are still the one true player.
                    console.log('Making play call')
                    player.play()
                  }
                })
              }
              
              // Preload the asset, which may eventually start the player if we
              // are supposed to playNow.
              player.preload()
            }
          })
    })
    
    // Handle requests to pause the music
    backend.ipc.on('player-pause', (event) => {
      if(backend.global_player !== null) {
        console.log('Pause global player')
        backend.global_player.pause()
      }
    })

    // And to play it again
    backend.ipc.on('player-play', (event) => {
      if(backend.global_player !== null) {
        console.log('Play global player')
        backend.global_player.play()
      }
    })
    
})
    
    console.log('Backend ready')
  }
  
  // Return the completed module object
  return backend
}(AV))
