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
    globalPlayer: null,
    // This determines if we should play the first globalPlayer we manage to
    // make, as soon as we can.
    playNow: false,    
    // This holds a song database
    database: {
      // This holds all the records in an array
      allSongs: [],
      // This maps from URL string to index in array
      byUrl: {}
    }
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
   * Given a Song object with title, album, artist, and url, add the song to the
   * metadata database if it doesn't already exist.
   */
  backend.loadSong = function(song) {
    // We ID songs uniquely by URL for now
    if (!backend.database.hasOwnProperty(song.url)) {
      // Keep the new song
      backend.database.allSongs.push(song)
      // Record where it is in the database
      backend.database[song.url] = backend.database.allSongs.length - 1
    }
  }
  
  /**
   * Download song records as JSON from the given URL and keep them in the local
   * database. URL may be ipfs:.
   */
  backend.loadSongs = function (url) {
    var parts = url.split(':')
    if (parts[0] == 'ipfs') {
      // This is an ipfs URL.
      backend.ipfsnode.catAll(parts[1], (err, fileData) => {
        if (err) {
          throw err
        }
        
        // We got something back. Parse it as JSON
        var parsed = JSON.parse(fileData.toString('utf-8'))
        
        for(var i = 0; i < parsed.length; i++) {
          // Add each item to the songs database if necessary
          backend.loadSong(parsed[i])
        }
        
      })
    } else {
      backend.getJSON(url).then(function (songs) {
        // Add all the songs we downloaded.
        console.log('Downloaded songs', songs)
        
        for(var i = 0; i < songs.length; i++) {
          // Add each item to the songs database if necessary
          backend.loadSong(songs[i])
        }
        
      }).catch(err => console.log(err))
    }
  }
  
  
  /**
   * Save the song database to IPFS as JSON. Call the callback with an error if
   * it fails, or null and the IPFS hash of the saved database if it succeeds.
   */
  backend.saveSongs = function(callback) {
    console.log('Saving database of %d songs', backend.database.allSongs.length)
  
    // Add it to IPFS
    var ipfs = backend.ipfsnode.ipfs
    ipfs.files.add(ipfs.Buffer.from(JSON.stringify(backend.database.allSongs)), (err, returned) => {
      if (err) {
        // IPFS didn't like it, so complain
        callback(err)
      }
      
      console.log('Database saved to IPFS hash:', returned[0].hash)
      
      // Call the callback with no error and the hash
      callback(null, returned[0].hash)
      
    })
  }
  
  /**
   * Search for songs containing the given string in their metadata. Returns a
   * function that, when called with a page number, calls a callback with that
   * page of the results as an array of Song objects.
   */
  backend.findSongs = function (query) {
    // This will keep a persistent array of page arrays, until nobody wants the
    // results anymore.
    var pages = []
    
    // This is our iteration index in allSongs
    var index = 0
    
    // This is our page size
    var pageSize = 10
    
    return function (page, pageHandler) {
      console.log('Finding page %d', page)
    
      while(index < backend.database.allSongs.length && page >= pages.length) {
        // Make a new page
        var newPage = []
        
        console.log('Generating page %d', pages.length)
        
        while (index < backend.database.allSongs.length && newPage.length < pageSize) {
          // We should search more songs
          
          // TODO: break up this loop so we don't scan all songs and make
          // everyone wait, but in a way that lets us cancel the operation
          // somehow.
          
          // How about this one
          var candidate = backend.database.allSongs[index]
          index++
          
          // Evaluate a match. For now, one field has to contain the query.
          // Later we can try lunr.js or something.
          var lowerQuery = query.toLowerCase()
          if (candidate.title.toLowerCase().includes(lowerQuery) ||
            candidate.artist.toLowerCase().includes(lowerQuery) ||
            candidate.album.toLowerCase().includes(lowerQuery)) {
            
            // This song is a match
            newPage.push(candidate)
            
          }
        }
        pages.push(newPage)
      }
      
      if(page < pages.length) {
        // We already know what's on this page. Send it back.
        pageHandler(pages[page])
      } else {
        // We couldn't generate that page. Send an empty page.
        pageHandler([])
      }
      
    }
  }

  /**
   * Add a song to the local metadata database with the metadata decoded from
   * the given file. Adds the file to IPFS to get its hash. Calls the callback
   * with null and the song object, if it turns out to be a readable song. Calls
   * the callback with an error if there is an error.
   */
  backend.addSong = function (fileData, callback) {
  
    // Load metadata and make sure it's audio
    var asset = AV.Asset.fromBuffer(fileData)
    
    asset.on('error', (err) => {
      // Report decoding errors
      callback(err)
    })
    
    asset.get('metadata', (metadata) => {
      // We got metadata, so it must be real audio
      console.log('Metadata', metadata)
      
      // Add it to IPFS
      var ipfs = backend.ipfsnode.ipfs
      ipfs.files.add(ipfs.Buffer.from(fileData), (err, returned) => {
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

        // Add it to the database if it's not there already
        backend.loadSong(song)
        
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
    
    backend.ipc.on('player-upload', (event, fileData) => {
      // Handle an ArrayBuffer of file data to upload.
      
      console.log('Uploading file...')
      
      backend.addSong(fileData, (err, song) => {
        if (err) {
          // Report errors
          throw err
        }
        
        // Give the user just this song to look at.
        // TODO: batch many songs if there are many being uploaded.
        event.sender.send('player-songs', [song])
        
      })
        
    })
    
    backend.ipc.on('player-search', (event, query) => {
      // Handle a search query
      
      // First, see if it's an IPFS hash
      var hashRegex = /(\/?ipfs\/|\/?ipns\/)?(Qm[A-HJ-NP-Za-km-z1-9]{44,45})/
      
      var found = query.match(hashRegex)
      
      if(found) {
        // This is an IPFS hash. Extract just the hash part
        // 0 is whole regex, 1 is IPFS/IPNS, 2 is actual hash
        var hash = found[2]
        
        console.log('Searching IPFS for', hash, found)
        
        // Use our wrapper to get the whoile file
        backend.ipfsnode.catAll(hash, (err, fileData) => {
          if (err) {
            throw err
          }
            
          backend.addSong(fileData, (err, song) => {
            if (err) {
              // It's not a song actually
              throw err
            }
            
            // It's a single song and we successfully loaded it
            
            // Give the user just this song to look at
            event.sender.send('player-songs', [song])
            
          })
        })
      } else {
        // It's not an IPFS hash for a song, so maybe it's a full text search
      
        console.log('Looking for songs matching', query)
      
        // Do a search and get the first page
        // TODO: allow paging forward and back
        var pager = backend.findSongs(query)
        
        pager(0, (results) => {
          console.log('Got %d search results', results.length)
          event.sender.send('player-songs', results)
        })
      }
    
    })
    
    backend.ipc.on('player-url', (event, url, playNow) => {
      // Play the given URL. Ought to be an ipfs:<hash> URL.
      
      console.log('Loading: %s', url)
      
      if(backend.globalPlayer !== null) {
        // If there's already a One True Player, get rid of it. Only one player
        // will be allowed to replace it, when an IPFS cat finally finishes.
        backend.globalPlayer.stop();
        backend.globalPlayer = null;
      }
      
      // Remember whether we want to play as soon as we can or not, but allow
      // that to be changed if we get a play or pause event while the data for
      // the song is being downloaded. TODO: this weird edge case goes away if
      // we write an IpfsSource for aurora.js
      backend.playNow = playNow
      
      // Get the track data from IPFS
      var ipfs = backend.ipfsnode.ipfs
        
      backend.ipfsnode.catAll(url.split(':')[1], (err, fileData) => {
        if (err) {
          throw err
        }
        
        if(backend.globalPlayer !== null) {
          // Someone else has beaten us to becoming the One True Player.
          // We have our data, but they ought to play instead.
          return
        }
        
        console.log('Playing: %s', url)
        
        // Make an asset from the buffer
        var asset = AV.Asset.fromBuffer(fileData)
            
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
        backend.globalPlayer = player;
        
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
        
        if(backend.playNow) {
          // We want to play the song as soon as we can
          console.log('Will play now')
          player.play()
        } else {
          // Just preload
          player.preload()
        }
      })
    })
    
    // Handle requests to pause the music
    backend.ipc.on('player-pause', (event) => {
      if(backend.globalPlayer !== null) {
        console.log('Pause global player')
        backend.globalPlayer.pause()
      } else {
        console.log('No global player; do not play when ready')
        backend.playNow = false
      }
    })

    // And to play it again
    backend.ipc.on('player-play', (event) => {
      if(backend.globalPlayer !== null) {
        console.log('Play global player')
        backend.globalPlayer.play()
      } else {
        console.log('No global player; play when ready')
        backend.playNow = true
      }
    })
    
    // Now import/export stuff
    
    // Import song metadata from the given URL
    backend.ipc.on('player-import', (event, url) => {
      // Use the song loader method
      backend.loadSongs(url)
    })
    
    // Export all song metadata to a URL and send it back in the player-exported
    // event.
    backend.ipc.on('player-export', (event, url) => {
      backend.saveSongs((err, hash) => {
        if (err) {
          // Complain about any errors
          throw err
        }
        
        console.log('Exported successfully')
        
        // Reply with the hash of the database
        event.sender.send('player-exported', 'ipfs:' + hash)
      })
    })
    
    console.log('Backend ready')
  }
  
  // Return the completed module object
  return backend
}(AV))
