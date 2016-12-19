// We define a player module using the Module Pattern
// See <http://www.adequatelygood.com/JavaScript-Module-Pattern-In-Depth.html>
var Player = (function () {

  // This will get exported and hold all the public stuff as the global Player
  var player = {
    // This tracks if we have been started
    ready: false,
    // This holds the callbacks to call after we boot up
    readyCallbacks: [],
    // This holds the Ractive object for the main player
    ractive: null,
    // This holds the initial ractive data
    data: {
      brandName: 'IPFSTunes',
      // This is the One True Play State, as an index into the playlist array. It gets watched by the code that
      // makes sound come out of the speakers, and set to play different songs.
      playingIndex: 0,
      // This holds the playback status. This is where we should be in a song.
      playback: {
        // Are we playing or paused?
        state: 'paused',
        // Song length in ms
        duration: 0,
        // Time elapsed in ms
        progress: 0
      },
      // This is a list of song records to play
      playlist: [],
      // These are the song results we are displaying to the user
      availableSongs: [],
      // This is the next noince value for songs added to the playlist
      nextNonce: 0,
      // This is the search query we're sending
      searchQuery: '',
      // This is the database hash we are exporting/importing
      // We start out pulling from the page hash
      databaseHash: (document && document.location && document.location.hash) ? document.location.hash.substring(2) : '',
      // This is the queue of songs to upload
      uploadQueue: []
    },
    
    // This is the event channel through which we communicate with the code
    // doing the actual song playing. We .send() evens at it, and listen for
    // returning events with .on().
    ipc: null
  }
  
  /**
   * Load the specified URL (which ought to be a Ractive template) and return
   * a promise for its string contents.
   */
  player.getTemplate = function (url) {
    // TODO: intern templates in our own cache?
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest()
      xhr.open('GET', url)
      xhr.overrideMimeType('text/plain')
      xhr.onload = function () {
        // This function gets the XHR as this, and fires when the XHR is
        // done, one way or the other.
        
        console.log('Got ' + url + ' with ' + xhr.statusText)
        
        // Grab the status
        var status = this.status
        if (status >= 200 && status < 300) {
          // Status code is in the success range
          resolve(xhr.responseText)
        } else {
          // Something else happened (server returned error)
          // We're upposed to reject with Error objects
          reject(Error('XHR refused: ' + xhr.statusText))
        }
      }
      xhr.onerror = function () {
        // Something happened and the request errored out
        reject(Error('XHR error: ' + xhr.statusText))
      }
      
      // Kick off the request.
      console.log('Getting ' + url)
      xhr.send()
    })
  }
  
  /**
   * Given a File object from the HTML5 Files API, immediately load all the
   * content and send it to the backend to be uploaded.
   */
  player.uploadFile = function(file) {
    // Make a reader to read the file
    var reader = new FileReader()
    reader.addEventListener('load', function(event) {
      // When the file is loaded, send it along
      console.log('Loaded file')
      player.ipc.send('player-upload', reader.result)
    })
    
    // Load an ArrayBuffer of file contents and send it to the backend
    reader.readAsArrayBuffer(file)
  }
  
  /**
   * Given a File object from the HTML5 Files API, queue it to be loaded and
   * sent to the backend for uploading.
   */
  player.queueUploadFile = function(file) {
    // Add to the queue
    player.ractive.push("uploadQueue", file);
  }
  
  /**
   * Return a unique ID (to distinguish instances of the same song in the
   * playlist, when the playlist entries are shifted around.
   */
  player.nonce = function () {
    var nonce = player.ractive.get('nextNonce')
    player.ractive.set('nextNonce', nonce + 1)
    return nonce
  }
  
  /**
   * Skip to the next song.
   */
  player.skipAhead = function () {
    // Play the next song
    var index = player.ractive.get('playingIndex')
    var playlist = player.ractive.get('playlist')
    
    
    if (index >= playlist.length) {
      // Already off the end
      return
    }
    
    // Otherwise we're still in the playlist. Go to the right.
    index += 1
    player.ractive.set('playingIndex', index)
    
    if (index >= playlist.length) {
      // If we go off the end, stop playback.
      player.ractive.set('playback.state', 'paused')
    } else {
      // Otherwise, start playback
      player.ractive.set('playback.state', 'playing')
    }
  }
  
  /**
   * Skip to the previous song.
   */
  player.skipBack = function () {
    // Play the previous song
    var index = player.ractive.get('playingIndex')
    var playlist = player.ractive.get('playlist')
    
    
    if (index == 0) {
      // Already at the first track
      return
    }
    
    // Otherwise we're still not at the start. Go to the left.
    index -= 1
    player.ractive.set('playingIndex', index)
    
    // Start playback of this track (which should exist)
    player.ractive.set('playback.state', 'playing')
  }
  
  /**
   * Import the database pointed to by the ractive. Can't happen on start,
   * because the backend may not be ready.
   */
  player.importDatabase = function () {
    // Grab the hash to import
    var hash = player.ractive.get('databaseHash')
    
    if (!hash) {
      // Don't do anything
      return
    }
    
    if (!hash.includes(':')) {
      // Add an IPFS protocol specifier
      hash = 'ipfs:' + hash 
    }
    
    console.log('Merging in database %s', hash)
    
    // Tell the backend to import this URL
    player.ipc.send('player-import', hash)
  }
  
  /**
   * Make a new Player on the page, in the given DOM element.
   */
  player.start = function (element, ipc) {
    // Save the IPC EventEmitter that we use to chat with the actual song-
    // playing code.
    player.ipc = ipc
  
    // Get the template text
    player.getTemplate('templates/player.html')
      .then(function (templateText) {
        // Make the Ractive
        player.ractive = new Ractive({
          el: element,
          template: templateText,
          data: player.data,
          computed: {
            // Compute the currently playing song from the playingIndex index and the playlist.
            // It can't be updated directly, but it updates when they do.
            nowPlaying: function () {
              var index = this.get('playingIndex')
              var playlist = this.get('playlist')
              if (index !== null && index >= 0 && index < playlist.length) {
                // This song is playing
                return playlist[index]
              } else {
                // No song is playing
                return null
              }
            },
            // Compute the song that will play next
            nextPlaying: function () {
              var index = this.get('playingIndex')
              var playlist = this.get('playlist')
              var state = this.get('playback.state')
              if (state == 'playing') {
                // The song that's at the playing index is playing right now, so
                // the next song to play is the song after it.
                index += 1;
              }
              if (index !== null && index >= 0 && index < playlist.length) {
                // This song is playing
                return playlist[index]
              } else {
                // No song is playing
                return null
              }
            }
          }
        })
        
        // Assign events
        player.ractive.on('play', function (event, index) {
          // Play event happened
          
          if (index !== undefined && index < this.get('playlist').length) {
            console.log('Starting song ' + index + '...')
            this.set({
              'playback.state': 'playing',
              'playingIndex': index
            })
          } else if (this.get('playingIndex') >= this.get('playlist').length) {
            // Can't play an out-of-bounds song
            console.log('Starting first song...')
            this.set({
              'playback.state': 'playing',
              'playingIndex': 0
            })
          } else {
            // We haven't been given an index, but we have one and it's in
            // range.
            this.set('playback.state', 'playing')
          }
          
          
        })
        
        player.ractive.on('pause', function (event) {
          // Pause event happened
          this.set('playback.state', 'paused')
        })
        
        player.ractive.on('skipAhead', function (event) {
          // Skip ahead event happened
          player.skipAhead()
        })
        
        player.ractive.on('skipBack', function (event) {
          // Skip back event happened
          player.skipBack()
        })
        
        player.ractive.on('queue', function (event, index) {
          // Play event happened
          var song = this.get('availableSongs[' + index + ']')
          // Put the song on the playlist in a playlist entry
          this.push('playlist', {song: song, nonce: player.nonce()})
        })
        
        player.ractive.on('remove', function (event, index) {
          // Playlist remove event happened
          
          // What are we playing now? May be what we're removing.
          var currentIndex = this.get('playingIndex')
          
          if (index < currentIndex) {
            // We need to remove something from now or in the past,
            // which necessitates a big atomic update.
            
            // Deep copy the playlist
            var newPlaylist = this.get('playlist').slice(0)
            
            // Drop the song
            newPlaylist.splice(index, 1)
            
            // Make the update
            this.set({
              playlist: newPlaylist,
              playingIndex: currentIndex - 1
            })
          } else {
            // The thing we are removing is in the future and can be
            // removed simply. If it's what we're on, we'll go off
            // the end or on to the next song.
            this.splice('playlist', index, 1)
          }
          
          // Don't play the song we're removing.
          return false
          
        })
        
        player.ractive.on('save', function (event, index) {
          // Add the song to the user's saved songs
          console.log('Saving song ' + index + '...')
          
          // TODO: implement
          
          return false
        })
        
        player.ractive.on('love', function (event, index) {
          // Add the song to the user's favorite (and saved) songs
          console.log('Loving song ' + index + '...')
          
          // TODO: implement
          
          return false
        })
        
        player.ractive.on('scrollPlaylist', function (event) {
          // Handle scrollwheel in playlist to make it scroll horizontally
          document.querySelector('.playlist').scrollLeft += event.original.deltaY          
        })
        
        player.ractive.on('upload', function (event) {
          // Handle file upload

          // Let's upload these files
          var toUpload = document.getElementById('upload').files
          
          // If nothing is already queued, we will need to kick off the upload
          var startUpload = player.ractive.get("uploadQueue").length == 0
          
          for(var i = 0; i < toUpload.length; i++) {
            // Queue each File object to be uploaded
            player.queueUploadFile(toUpload[i])
          }
          
          // Clear out the upload control
          document.getElementById('upload').value = null
          
          // Clear out the available song list to fill it
          player.ractive.set("availableSongs", [])
          
          if (startUpload) {
            // Kick off the first upload, since nothing is uploading yet.
            player.ractive.pop("uploadQueue").then(function (file) {
              // Pop off the next thing to upload and upload it
              player.uploadFile(file)
            });
          }
          
        })
        
        player.ipc.on('player-uploaded', function (event, err, song) {
            // Handle upload results
            
            player.ractive.pop("uploadQueue").then(function (file) {
              // Pop off the next thing
              if (file) {
                // If there is one, upload it
                player.uploadFile(file)
              } else {
                // Queue complete, export database and update page hash. Don't
                // export after every file or we will make way too many
                // databases...
                player.ipc.send('player-export')
              }
            });
            
            // While that's happening
            
            if (err) {
              // Upload failed
              throw err
            } else {
              // Upload succeeded and we have a song
              player.ractive.push("availableSongs", song)
            }
        })
        
        // Watch the nowPlaying state and make actual sound
        player.ractive.observe('nowPlaying', function (val) {
          console.log('Now playing: ', val)
          if (val == null) {
            // Pause if there's nothing to play.
            this.set('playback.state', 'paused')
          }
        })
        
        // Watch the nextPlaying state and preload songs
        player.ractive.observe('nextPlaying.song.url', function (val) {
          if (val != null) {
              // Hint the song to the backend so it knows it may be played soon.
              player.ipc.send('player-hint', val)
          }
        })
        
        player.ractive.observe('playlist', function (val) {
          if (val.length === undefined) {
            // Skip out on bogus playlists
            return
          }
          
          if (this.get('playingIndex') > val.length) {
            // When things get removed from the playlist, and we're
            // off the end, we need to walk back to the past-the-end
            // index for the shorter playlist.
            this.set('playingIndex', val.length)
          }
        })
        
        player.ractive.observe('playback.state', function (val) {
          if (val == 'playing' && this.get('nowPlaying') == null) {
            // We can't play a song that's not present.
            this.set('playback.state', 'paused')
          } else if (val == 'paused') {
            player.ipc.send('player-pause')
          } else {
            player.ipc.send('player-play')
          }
        })
        
        
        player.ractive.observe('nowPlaying.nonce', function (newValue, oldValue, keypath) {
          // We watch the nonce because different playlist entries for
          // the same song should be distinct and need to fire the
          // observer.
          
          // What's the new URL?
          var newUrl = undefined
          if (newValue !== undefined && newValue !== null) {
            newUrl = this.get('nowPlaying.song.url')
          }

          // Pause any currently playing song
          player.ipc.send('player-pause')
          
          if (newUrl !== undefined && newUrl != '') {
            // Start playing the new song
            console.log('Changing song')

            // We dont want to start immediately unless we think we're playing.
            var playNow = (player.ractive.get('playback.state') == 'playing')
            
            // Say to start playing this URL
            player.ipc.send('player-url', newUrl, playNow)
          }
        })
        
        // We also need to updat the ractive when we get messages from
        // the music player itself.
        
        // Handle song duration in ms
        player.ipc.on('player-duration', function (event, duration) {
          
          if (isNaN(duration)) {
            // Ignore NaN duration
            return
          }
          
          player.ractive.set('playback.duration', duration)
        })
        
        // Handle song progress in ms
        player.ipc.on('player-progress', function (event, progress) {
          
          if (isNaN(progress)) {
            // Ignore NaN progress
            return
          }
          
          player.ractive.set('playback.progress', progress)
        })
        
        // And one for when the song ends
        player.ipc.on('player-ended', function (event) {
          // Go to the next song.
          player.skipAhead()
        })
        
        // And now the stuff we need for search
        
        // Handle a search request from the user
        player.ractive.on('search', function (event) {
          // When someone hits search, send a search event
          player.ipc.send('player-search', player.ractive.get('searchQuery'))
        })
        
        // And for when we get a page of songs to show
        player.ipc.on('player-songs', function (event, songs) {
          // Just override all the songs we have already
          player.ractive.set('availableSongs', songs)
        })
        
        // And now the stuff we need for database import/export
        
        // Handle importing some song metadata
        player.ractive.on('import-db', function (event) {
            
            player.importDatabase()
        })
        
        // Handle when the backend says it's done importing
        player.ipc.on('player-imported', function (event) {
            // Immediately export the DB
            player.ipc.send('player-export')
        })
        
        // Handle exporting all song metadata
        player.ractive.on('export-db', function (event) {
            // Tell the backend to export and send us an event back
            player.ipc.send('player-export')
        })
        
        // Handle an exported-to-URL event
        player.ipc.on('player-exported', function (event, url) {
          // Just display the URL
          console.log('Current database URL: ', url)
          player.ractive.set('databaseHash', url)
        })
        
        // Keep the window location hash in sync with the exported database
        player.ractive.observe('databaseHash', function (val) {
            document.location.hash = '#!' + val
        })
        
        // Mark the player ready and tell everyone who has been waiting
        player.ready = true
        while (player.readyCallbacks.length > 0) {
          callback = player.readyCallbacks.pop()
          callback()
        }
        
      })
      // Or complain about an error
      .catch(err => console.log(err))
  }
  
  /**
   * Call the given callback after the player is ready to process events and
   * handle function calls besides start.
   */
  player.onReady = function (callback) {
    if (player.ready) {
      // Ready now
      callback()
    } else {
      // Call when ready
      player.readyCallbacks.push(callback);
    }
  }
  
  // Export the module object
  return player
}())
