// Provides a backend that plays songs with AV and mp3.js.
// Expects aurora.js dependency as a module argument.
var Backend = (function (AV) {

  // Make the object we will export as our singleton sound-playing backend thingy.
  var backend = {
    // This tracks if we have been started
    ready: false,
    // This holds the callbacks to call after we boot up
    readyCallbacks: [],
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
      // This maps from song file hex hash (not IPFS hash) to index in array
      byHash: {}
    },
    // This holds a map from hex hash to encrypted URL for ipfs+A256GCM.
    // This lets us avoid encrypting the same thing again if we want to save it twice.
    // Especially useful for the song database export.
    hashToEncryptedUrl: {}
  }
  
  /**
   * Load the given URL as an ArrayBuffer or UInt8Array or similar.
   * Supports ipfs: and ipfs+A256GCM: with # separating hash from key.
   * Also supports anything Fetch supports.
   */
  backend.loadUrl = function(url, callback) {
    var parts = url.split(':')
    if (parts[0] == 'ipfs') {
      // This is an ipfs URL.
      backend.ipfsnode.ipfs.files.cat(parts[1], callback)
    } else if (parts[0] == 'ipfs+A256GCM') {
      // It is encrypted
      
      var urlParts = parts[1].split('#')
      var ipfsHash = urlParts[0]
      var key = urlParts[1]
      
      backend.loadUrl('ipfs:' + ipfsHash, async (err, data) => {
        // Go download the encrypted blob
        if (err) {
          return callback(err)
        }
        
        // Decrypt the data
        var decrypted
        try {
          decrypted = await EasyCrypto.decrypt(data, key)
          
          // Compute its hash in case we are asked to save the same data again
          var hexHash = await EasyCrypto.hash(decrypted)
          backend.hashToEncryptedUrl[hexHash] = url
        } catch (err) {
          return callback(err)
        }
        
        // Return the decrypted data
        callback(null, decrypted)
      })
       
    } else {
      // It is probably something Fetch can do
      fetch(new Request(url)).then((response) => {
        return response.arrayBuffer()
      }).catch((err) => {
        callback(err)
      }).then((buffer) => {
        callback(null, buffer)
      })
    }
  }
  
  /**
   * Save the given typed array/buffer data to a URL of the given scheme.
   * Supports ipfs and ipfs+A256GCM as schemes.
   *
   * For encrypted destinations, also calls back with the plaintext hash as a
   * hex string (so the callback can take 3 arguments).
   */
  backend.saveToUrl = function(scheme, fileData, callback) {
    if (scheme == 'ipfs') {
      // Save unencrypted data to IPFS
      var ipfs = backend.ipfsnode.ipfs
      ipfs.files.add(backend.ipfsnode.Buffer.from(fileData), (err, returned) => {
        if (err) {
          // IPFS didn't like it, so complain
          return callback(err)
        }
        
        console.log('IPFS hash:', returned[0].hash)
        callback(null, 'ipfs:' + returned[0].hash)
      })
    } else if (scheme == 'ipfs+A256GCM') {
      // First we need to know if we already know an encrypted URL for this data.
      // So we hash it.
      EasyCrypto.hash(fileData).catch((err) => {
        return callback(err)
      }).then((hexHash) => {
        
        // We will fill this with a promise for the key to use for encryption.
        var keyPromise
        
        if (backend.hashToEncryptedUrl.hasOwnProperty(hexHash)) {
          // We already have a URL where this data should live.
          var url = backend.hashToEncryptedUrl[hexHash]
          
          // We don't know that the data is still accessible in IPFS at that URL.
          // But luckily we can re-encrypt the same data with the same key and get the same blob.
          // So we will re-insert.
          // We just need to make sure to use the same key.
          var key = url.split(':')[1].split('#')[1]
          console.log('Duplicate data ' + hexHash + ' should use key ' + key)
          
          keyPromise = new Promise((resolve, reject) => {
            resolve(key)
          })
        } else {
          // Otherwise we have to make a new key.
          keyPromise = EasyCrypto.generateKey()
        }
        
        // Get the key
        keyPromise.catch((err) => {
          return callback(err)
        }).then((key) => {
          EasyCrypto.encrypt(fileData, key).catch((err) => {
            return callback(err)
          }).then((encryptedData) => {
            // Save the encrypted data to IPFS
            backend.saveToUrl('ipfs', encryptedData, (err, ipfsUrl) => {
              if (err) {
                return callback(err)
              }
            
              var parts = ipfsUrl.split(':')
              // Put together a URL containing the key
              var url = 'ipfs+A256GCM:' + parts[1] + '#' + key
              
              // Cache it
              backend.hashToEncryptedUrl[hexHash] = url
              
              // And send it back
              callback(null, url, hexHash)
            })
          })
        })
      })
    } else {
      // Can't write this
      return callback(new Error('Unsupported scheme ' + scheme + ' for writing'))
    }
  }
  
  
  /**
   * Given a Song object with title, album, artist, url, and hash, add the song to the
   * metadata database if it doesn't already exist.
   */
  backend.loadSong = function(song) {
    // We ID songs uniquely by file hash for now
    if (!backend.database.byHash.hasOwnProperty(song.hash)) {
      // Keep the new song
      backend.database.allSongs.push(song)
      // Record where it is in the database
      backend.database.byHash[song.hash] = backend.database.allSongs.length - 1
    }
    
    if (song.url.split(':')[0] == 'ipfs+A256GCM') {
      // We will also hint the hash to encrypted URL database, in case the user
      // tries to upload this song twice!
      if (!backend.hashToEncryptedUrl.hasOwnProperty(song.hash)) {
        backend.hashToEncryptedUrl[song.hash] = song.url
      }
    }
    
  }
  
  /**
   * Download song records as JSON from the given URL and keep them in the local
   * database. URL may be ipfs:.
   * Calls the callback with an error, or null if everything works.
   */
  backend.loadSongs = function (url, callback) {
    backend.loadUrl(url, (err, fileData) => {
      // Download the URL where the song data is
      if (err) {
        return callback(err)
      }
      
      // We got something back. Parse it as UTF-8 JSON
      var parsed = JSON.parse(new TextDecoder('utf-8').decode(fileData))
      
      for(var i = 0; i < parsed.length; i++) {
        // Add each item to the songs database if necessary
        backend.loadSong(parsed[i])
      }
      
      callback(null)
      
    })
  }
  
  
  /**
   * Save the song database to IPFS as JSON. Call the callback with an error if
   * it fails, or null and the URL of the saved database if it succeeds.
   */
  backend.saveSongs = function(callback) {
    console.log('Saving database of %d songs', backend.database.allSongs.length)
  
    // Add it to IPFS
    var ipfs = backend.ipfsnode.ipfs
    backend.saveToUrl('ipfs+A256GCM', new TextEncoder().encode(JSON.stringify(backend.database.allSongs)), (err, url) => {
      if (err) {
        // IPFS didn't like it, so complain
        return callback(err)
      }
      
      console.log('Database saved to:', url)
      
      // Call the callback with no error and the hash
      callback(null, url)
      
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
    var pageSize = 50
    
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
  
    try {
      // Put the whole thing in a try-catch in case Aurora explodes
  
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
        backend.saveToUrl('ipfs+A256GCM', fileData, (err, url, hexHash) => {
          // We are interested in the plaintext hash for ID-ing/deduplicating songs.
          if (err) {
            // IPFS didn't like it, so complain
            return callback(err)
          }
          
          console.log('Saved URL:', url)
          
          // Craft a song object
          var song = {
            title: metadata.title,
            album: metadata.album,
            artist: metadata.artist,
            hash: hexHash,
            url: url
          }

          // Add it to the database if it's not there already
          backend.loadSong(song)
          
          // Call the callback with no error and the song
          callback(null, song)
          
        })
        
      })
    } catch (err) {
      callback(err)
    }
  
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
          // Report errors, but make sure to send them back so the next song in
          // the queue can be tried
          event.sender.send('player-uploaded', err)
        }
        
        // Say we uploaded the song
        event.sender.send('player-uploaded', null, song)
        
      })
        
    })
    
    backend.ipc.on('player-search', (event, query, pageNumber) => {
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
        backend.ipfsnode.ipfs.files.cat(hash, (err, fileData) => {
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
        // TODO: reuse the pager
        var pager = backend.findSongs(query)
        
        pager(pageNumber, (results) => {
          console.log('Got %d search results', results.length)
          event.sender.send('player-songs', results)
        })
      }
    
    })
    
    // We can get hints that URLS will be played soon and that we should go
    // looking for their content.
    backend.ipc.on('player-hint', (event, url) => {
      
      backend.loadUrl(url, (err, data) => {
        if (err) {
          throw err
        }
        
        console.log('Downloaded file for hint: %s', url)
        
        // Discard the data for now
        
      })
    
    })
    
    // Actually play URLs
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
      
      // Get the track data
      backend.loadUrl(url, (err, fileData) => {
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
      backend.loadSongs(url, (err) => {
        if (err) {
          throw err
        }
        
        event.sender.send('player-imported')
        
      })
    })
    
    // Export all song metadata to a URL and send it back in the player-exported
    // event.
    backend.ipc.on('player-export', (event, url) => {
      backend.saveSongs((err, url) => {
        if (err) {
          // Complain about any errors
          throw err
        }
        
        console.log('Exported successfully')
        
        // Reply with the hash of the database
        event.sender.send('player-exported', url)
      })
    })
    
    console.log('Backend ready')
    
    // Mark the backend ready and tell everyone who has been waiting
    backend.ready = true
    while (backend.readyCallbacks.length > 0) {
      callback = backend.readyCallbacks.pop()
      callback()
    }
  }
  
  /**
   * Call the given callback after the backend is ready to process IPC events.
   */
  backend.onReady = function (callback) {
    if (backend.ready) {
      // Ready now
      callback()
    } else {
      // Call when ready
      backend.readyCallbacks.push(callback);
    }
  }
  
  // Return the completed module object
  return backend
}(AV))
