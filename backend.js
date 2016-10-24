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
    global_player: null,
    // This holds a song database
    all_songs: []
  }
  
  /**
   * Download and parse some JSON, and return a promise.
   */
  backend.getJSON = function (url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest()
      xhr.open("GET", url)
      xhr.overrideMimeType("text/json")
      xhr.onload = function () {
        // This function gets the XHR as this, and fires when the XHR is
        // done, one way or the other.
        
        console.log("Got " + url + " with " + xhr.statusText)
        
        // Grab the status
        var status = this.status
        if (status >= 200 && status < 300) {
          // Status code is in the success range
          var parsed
          try {
            // Parse the JSON
            parsed = JSON.parse(xhr.responseText)
          } catch(err) {
            // We can't parse this JSON
            reject(err)
          }
          
          // OK we parsed it!
          resolve(parsed)
        } else {
          // Something else happened (server returned error)
          // We're upposed to reject with Error objects
          reject(Error("XHR refused: " + xhr.statusText))
        }
      }
      xhr.onerror = function () {
        // Something happened and the request errored out
        reject(Error("XHR error: " + xhr.statusText))
      }
      
      // Kick off the request.
      console.log("Getting " + url)
      xhr.send()
    })
  }
  
  /**
   * Download song records as JSON from the given URL and keep them in the local
   * database.
   */
  backend.load_songs = function (url) {
    backend.getJSON(url).then(function (songs) {
      // Add all the songs we downloaded.
      console.log('Downloaded songs', songs)
      backend.all_songs = backend.all_songs.concat(songs)
    }).catch(err => console.log(err))
  }
  
  /**
   * Search for songs containing the given string in their metadata. Returns a
   * function that, when called with a page number, calls a callback with that
   * page of the results as an array of Song objects.
   */
  backend.find_songs = function (query) {
    // This will keep a persistent array of page arrays, until nobody wants the
    // results anymore.
    var pages = []
    
    // This is our iteration index in all_songs
    var index = 0
    
    // This is our page size
    var page_size = 10
    
    return function (page, page_handler) {
      console.log('Finding page %d', page)
    
      while(index < backend.all_songs.length && page >= pages.length) {
        // Make a new page
        var new_page = []
        
        console.log('Generating page %d', pages.length)
        
        while (index < backend.all_songs.length && new_page.length < page_size) {
          // We should search more songs
          
          // TODO: break up this loop so we don't scan all songs and make
          // everyone wait, but in a way that lets us cancel the operation
          // somehow.
          
          // How about this one
          var candidate = backend.all_songs[index]
          index++
          
          // Evaluate a match. For now, one field has to contain the query.
          // Later we can try lunr.js or something.
          var lower_query = query.toLowerCase()
          if (candidate.title.toLowerCase().includes(lower_query) ||
            candidate.artist.toLowerCase().includes(lower_query) ||
            candidate.album.toLowerCase().includes(lower_query)) {
            
            // This song is a match
            new_page.push(candidate)
            
          }
        }
        pages.push(new_page)
      }
      
      if(page < pages.length) {
        // We already know what's on this page. Send it back.
        page_handler(pages[page])
      } else {
        // We couldn't generate that page. Send an empty page.
        page_handler([])
      }
      
    }
  }

  /**
   * Add a song to the local metadata database with the metadata decoded from
   * the given file. Adds the file to IPFS to get its hash. Calls the callback
   * with null and the song object, if it turns out to be a readable song. Calls
   * the callback with an error if there is an error.
   */
  backend.add_song = function (file_data, callback) {
  
    // Load metadata and make sure it's audio
    var asset = AV.Asset.fromBuffer(file_data)
    
    asset.on('error', (err) => {
      // Report decoding errors
      callback(err)
    })
    
    asset.get('metadata', (metadata) => {
      // We got metadata, so it must be real audio
      console.log('Metadata', metadata)
      
      // Add it to IPFS
      var ipfs = backend.ipfsnode.ipfs
      ipfs.files.add(ipfs.Buffer.from(file_data), (err, returned) => {
        if (err) {
          // IPFS didn't like it, so complain
          callback(err)
        }
        
        console.log('IPFS hash:', returned[0].hash)
        
        // Craft a song object
        var song = {
          title: metadata.title,
          album: metadata.album,
          artist: metadata.artist,
          url: 'ipfs:' + returned[0].hash
        }

        // Add it to the database
        backend.all_songs.push(song)
        
        // Call the callback with no error and the song
        callback(null, song)
        
      })
      
    })
  
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
      
      console.log('Uploading file...')
      
      backend.add_song(file_data, (err, song) => {
        if (err) {
          // Report errors
          throw err
        }
        
        // Send updated datatabse to the player so it displays it.
        event.sender.send('player-songs', backend.all_songs)
        
      })
        
    })
    
    backend.ipc.on('player-search', (event, query) => {
      // Handle a search query
      
      // First, see if it's an IPFS hash
      var hash_regex = /(\/?ipfs\/|\/?ipns\/)?(Qm[A-HJ-NP-Za-km-z1-9]{44,45})/
      
      var found = query.match(hash_regex)
      
      if(found) {
        // This is an IPFS hash. Extract just the hash part
        // 0 is whole regex, 1 is IPFS/IPNS, 2 is actual hash
        var hash = found[2]
        
        console.log('Searching IPFS for', hash, found)
        
        // Use our wrapper to get the whoile file
        backend.ipfsnode.cat_all(hash, (err, file_data) => {
          if (err) {
            throw err
          }
            
          backend.add_song(file_data, (err, song) => {
            if (err) {
              throw err
            }
            
            // Send entire updated datatabse to the player so it displays it.
            event.sender.send('player-songs', backend.all_songs)
            
          })
        })
      } else {
        // It's not an IPFS hash for a song, so maybe it's a full text search
      
        console.log('Looking for songs matching', query)
      
        // Do a search and get the first page
        // TODO: allow paging forward and back
        var pager = backend.find_songs(query)
        
        pager(0, (results) => {
          console.log('Got %d search results', results.length)
          event.sender.send('player-songs', results)
        })
      }
    
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
        
      backend.ipfsnode.cat_all(url.split(':')[1], (err, file_data) => {
        if (err) {
          throw err
        }
        
        console.log('Playing: %s', url)
        
        // Make an asset from the buffer
        var asset = AV.Asset.fromBuffer(file_data)
            
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
    
    console.log('Backend ready')
  }
  
  // Return the completed module object
  return backend
}(AV))
