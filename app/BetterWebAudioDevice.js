// Provides a better WebAudio-based audio device for Aurora.js that uses buffers
// instead of a ScriptProcessor. Expects aurora.js and resampler dependencies as
// module arguments.
var BetterWebAudioDevice = (function (AV, Resampler) {

  // Use a shiny new ES6 class that inherits from the base AudioDevice.
  // Basically what we do is add AudioBufferSourceNodes scheduled to start one
  // after the other, to hold the whole song.
  class BetterWebAudioDevice extends EventEmitter {
    // Make a new device at the given sample rate, with the given number of
    // channels
    constructor (sampleRate, channels) {
      // Save input audio sample rate and channel number
      this.sampleRate = sampleRate
      this.channels = channels
    
      if (BetterWebAudioDevice.sharedContext == null) {
        // Make sure we have a context to play in
        BetterWebAudioDevice.sharedContext = new AudioContext()
      }
      this.context = BetterWebAudioDevice.sharedContext
      
      // The audio context itself may operate at a different sample rate
      this.deviceSampleRate = this.context.sampleRate
      
      // How big of a device buffer do we want to make for each piece of audio?
      this.outputBufferSize = 16384
      
      // How big should each input buffer be, before any resampling?
      this.inputBufferSize  = Math.ceil(this.outputBufferSize / (this.deviceSampleRate / this.sampleRate) * this.channels)
      this.inputBufferSize += this.inputBufferSize % this.channels
      
      if (this.deviceSampleRate != sampleRate) {
        // We need to resample
        this.resampler = new Resampler(sampleRate, this.deviceSampleRate, this.channels, this.inputBufferSize)
      } else {
        this.resampler = null
      }
      
      // We need a queue of AudioBufferSourceNodes
      this.nodeQueue = []
      // And a queue of start times for nodes
      this.startQueue = []
      
      
    }
    
    // Emit a refill and, when it comes back, stick the data in. The buffer
    // might not get filled if playback is paused or data isn't available or
    // something.
    get_data () {
      // Set up an array to put the data in
      var data = new Float32Array(this.inputBufferSize)
      // Ask for the data
      this.emit('refill', data)
      
      if (this.resampler) {
        // Resample data if needed
        data = this.resampler.resampler(data)
      }
      
      // Blit into this buffer
      var outputBuffer = this.context.createBuffer(this.channels, this.outputBufferSize, this.devicsSampleRate)
      var channelCount = outputBuffer.numberOfChannels
      var channels = new Array(channelCount)
        
      for (var i = 0; i < channelCount; i++) {
        // Get output channels into an array
        channels[i] = outputBuffer.getChannelData(i)
      }
      
      // Fill in the channels, de-interleaving
      for (var i = 0; i < outputBuffer.length; i++) {
        // For each time step
        for (var n = 0; n < channelCount; n++) {
          // For each channel
          
          // Copy the data for that time point and channel
          channels[n][i] = data[i * channelCount + n]
        }
      }
      
      // Now we need to stick on a node that plays this audio
      var source = this.context.createBufferSource();
      source.buffer = outputBuffer;
      // Connect it to the destination node
      source.connect(this.context.destination);
      
      if (nodeQueue.length == 0) {
        // This is the first node
        // Put it in the queue
        this.nodeQueue.push(source);
        
        // Decide on a start time
        // Offset it a bit from here
        var startTime = this.context.currentTime + 0.1
        
        // start the source playing at that time
        source.start(startTime);
        
        // And remember when the source is starting
        this.startQueue.push(startTime);
      } else {
        // Find the last source and its start time
        var lastSource = this.nodeQueue[this.nodequeue.length - 1]
        var lastStart = this.startQueue[this.startQueue.length - 1]
        
        // Now guess its end time
        var lastEnd = lastStart + lastSource.buffer.duration;
        
        // Start this next buffer exactly when the last one ends
        this.nodeQueue.push(source);
        source.start(lastEnd);
        this.startQueue.push(lastEnd);
      }
          
      
    }
    
    // Shut down the device and stop making sound
    destroy () {
      for (var i = 0; i < this.nodeQueue.length; i++) {
        // Disconnect all the nodes
        this.nodeQueue[i].disconnect(0);
      }
      
      // Throw them and their start times out
      this.nodeQueue = []
      this.startQueue = []
    }
     
    // Get the current playback time in input-space samples   
    getDeviceTime () {
      return this.context.currentTime * this.sampleRate
    }

  }

  // This holds a single shared AudioContext that we can use, because they are
  // heavy and limited in number
  BetterWebAudioDevice.sharedContext = null;
  
  // Mark it as supported. We just assume.
  BetterWebAudioDevice.supported = true;
  
  // Hack so we can maybe swap this out for the base AudioDevice class in Aurora's code somehow.
  BetterWebAudioDevice.create = function (sampleRate, channels) {
    return new BetterWebAudioDevice(sampleRate, channels)
  }
  
  // Hack Aurora.js to use us instead of whatever it ships with
  BetterWebAudioDevice.take_over = function() {
    // Make all the kinds of devices Aurora supports
    var other_instance;
    do {
      // Make an instance
      other_instance = AV.AudioDevice.create(44100, 2);
      if (other_instance != null) {
        // Mark its type as unsupported
        other_instance.constructor.supported = false
      }
    } while (other_instance != null)
    
    // Now all the other devices are no longer supported. Add this one as an option.
    AV.AudioDevice.register(BetterWebAudioDevice)
  }

  // Automatically replace everything Aurora has
  BetterWebAudioDevice.take_over()

  return BetterWebAudioDevice
  
}(AV, Resampler))
