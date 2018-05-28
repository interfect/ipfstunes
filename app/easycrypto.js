/// EasyCrypto: wrapper around window.crypto.subtle that lets you pass around simple encoded strings as keys.
/// Suitable for protecting your personal song library from being played by others.
/// May or may not be sufficient to prevent you from distributing music without a license
/// if you import songs you are not allowed to make available to others.
/// Note that the encryption is deterministic and repeatable: every time you encrypt a file with a key, you get the same answer.
/// IVs are not re-used across different files, but sending the same file twice is obvious.
/// File sizes are also leaked.
var EasyCrypto = (function () {
  
  // Define a module
  var easycrypto = {}
  
  // Define key algorithm
  easycrypto.algo = {
    name: 'AES-GCM',
    length: 256
  }
  
  // We will use 16-byte IVs prepended to messages
  easycrypto.ivLength = 16
  
  // And the usages array we need
  easycrypto.usages = ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  
  // And the hash algorithm we use for hashing
  easycrypto.hashAlgo = 'SHA-256'
  
  /// Convert a bare key string to JWK for import.
  /// Assumes it is using the parameters we use
  easycrypto.stringToJwk = function(keyString) {
    // TODO: alg must agree with easycrypto.algo
    return {alg: 'A256GCM', ext: true, k: keyString, key_ops: easycrypto.usages, kty: 'oct'}
  }
  
  /// Extract just the key string from a JWK format key.
  /// Discards the parameter info
  easycrypto.jwkToString = function(jwk) {
    return jwk.k
  }

  /// Encrypt an ArrayBuffer with the given key string. Returns a Promise for the result.
  /// Guarantees that the same data encrypted with the same key always returns the same encrypted blob.
  easycrypto.encrypt = async function(dataBuffer, key) {
    // Import the key from a nice string
    // Decide it's JWK
    var importedKey = await crypto.subtle.importKey('jwk', easycrypto.stringToJwk(key), easycrypto.algo, true, easycrypto.usages)
    
    // Make an IV by hashing the plaintext and then the key.
    // This is deterministic, non-repeating, and doesn't leak the file hash as the IV.
    
    // First turn the key string (in whatever encoding JWK uses) into bytes
    // This isn't the same as the actual value of the key but it should be good enough
    var keyBytes = (new TextEncoder()).encode(key)
    
    // Put it after the message
    var messageWithKey = new Uint8Array(dataBuffer.length + keyBytes.length)
    messageWithKey.set(dataBuffer)
    messageWithKey.set(keyBytes, dataBuffer.length)
    
    // We hash and then truncate the hash to the chosen IV length.
    var iv = (new Uint8Array(await crypto.subtle.digest(easycrypto.hashAlgo, messageWithKey))).subarray(0, easycrypto.ivLength)
    
    // Use the key and make an encrypted buffer
    var encrypted = await crypto.subtle.encrypt({name: easycrypto.algo.name, iv: iv}, importedKey, dataBuffer)
    
    // View as bytes
    var encryptedArray = new Uint8Array(encrypted)
    
    // Tack on IV
    var encryptedWithIv = new Uint8Array(iv.length + encryptedArray.length)
    encryptedWithIv.set(iv)
    encryptedWithIv.set(encryptedArray, iv.length)
    
    return encryptedWithIv
  }
  
  /// Decrypt an ArrayBuffer with the given key string.
  easycrypto.decrypt = async function(dataBuffer, key) {
    // Import the key from a nice string
    // Decide it's JWK
    var importedKey = await crypto.subtle.importKey('jwk', easycrypto.stringToJwk(key), easycrypto.algo, true, easycrypto.usages)
    
    // View as bytes
    var encryptedWithIv = new Uint8Array(dataBuffer)
    
    // Take out the iv
    var iv = encryptedWithIv.subarray(0, easycrypto.ivLength)
    // And the message
    var encryptedArray = encryptedWithIv.subarray(easycrypto.ivLength)
    
    // Decrypt with the specified IV and return
    // TODO: Will decrypt be happy with a TypedArray and not a whole ArrayBuffer
    return crypto.subtle.decrypt({name: easycrypto.algo.name, iv: iv}, importedKey, encryptedArray)
  }
  
  /// Generate a new key, as a string.
  easycrypto.generateKey = async function() {
    var generatedKey = await crypto.subtle.generateKey(easycrypto.algo, true, easycrypto.usages)
    return easycrypto.jwkToString(await crypto.subtle.exportKey('jwk', generatedKey))
  }
  
  /// Hash the given buffer and return its hash as a string.
  easycrypto.hash = async function(dataBuffer) {
    var hashBuffer = await crypto.subtle.digest(easycrypto.hashAlgo, dataBuffer)
    // See https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest for the nice bytes-to-hex trick.
    var hexHash = Array.from(new Uint8Array(hashBuffer)).map(b => ('00' + b.toString(16)).slice(-2)).join('')
    return hexHash
  }

  // Export the module object
  return easycrypto
}())

/** Test code:

(async function() {
    try {
        var key = await EasyCrypto.generateKey()
        console.log(key)
        
        var data = 'I am a cat.'
        var enc = new TextEncoder()
        var buf = enc.encode(data)
        
        var encrypted = await EasyCrypto.encrypt(buf, key)
        console.log(encrypted)
        var decrypted = await EasyCrypto.decrypt(encrypted, key)
        
        var dec = new TextDecoder('utf-8')
        var decoded = dec.decode(decrypted)
        
        console.log(decoded)
        
    } catch (err) {
        console.log(err)
    }
})()

*/

