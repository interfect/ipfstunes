/*

	ractive-events-mousewheel
	=========================

	Version 0.1.1.

	Dealing with mousewheel events in browsers is an epic pain. The
	official DOM wheel event is badly designed enough that Chrome,
	Opera and Safari have so far refused to implement it, which isn't
	to say that the non-standard mousewheel event (or the DOMMouseScroll
	and MozMousePixelScroll events &ndash; yes, really) is a whole lot
	better. It's a total mess.

	The mousewheel event plugin is a (work-in-progress!) attempt to
	smooth over differences between browsers and operating systems, and
	provide you with the only bit of information you actually care about
	in 99% of cases: how many pixels of scroll the mousewheel event is
	equivalent to.

	Be aware that intercepting mousewheel events rather than using native
	scroll is often a bad idea &ndash; it doesn't perform as well in all
	cases, and doesn't work with mobile devices.

	Thanks to https://github.com/brandonaaron/jquery-mousewheel for
	figuring out a lot of this stuff.

	==========================

	Troubleshooting: If you're using a module system in your app (AMD or
	something more nodey) then you may need to change the paths below,
	where it says `require( 'ractive' )` or `define([ 'ractive' ]...)`.

	==========================

	Usage: Include this file on your page below Ractive, e.g:

	    <script src='lib/ractive.js'></script>
	    <script src='lib/ractive-events-mousewheel.js'></script>

	Or, if you're using a module loader, require this module:

	    // requiring the plugin will 'activate' it - no need to use
	    // the return value
	    require( 'ractive-events-mousewheel' );

	Add a mousewheel event in the normal fashion:

	    <div on-mousewheel='scroll'>scroll here</div>

	Then add a handler:

	    ractive.on( 'scroll', function ( event ) {
	      alert( event.dx, event.dy ); // dx and dy - pixel scroll equivalent values
	    });

*/

(function ( global, factory ) {

	'use strict';

	// Common JS (i.e. browserify) environment
	if ( typeof module !== 'undefined' && module.exports && typeof require === 'function' ) {
		factory( require( 'ractive' ) );
	}

	// AMD?
	else if ( typeof define === 'function' && define.amd ) {
		define([ 'ractive' ], factory );
	}

	// browser global
	else if ( global.Ractive ) {
		factory( global.Ractive );
	}

	else {
		throw new Error( 'Could not find Ractive! It must be loaded before the ractive-events-mousewheel plugin' );
	}

}( typeof window !== 'undefined' ? window : this, function ( Ractive ) {

	'use strict';

	var mousewheel, events;

	if ( typeof document === 'undefined' ) {
		return;
	}

	// Modern Firefox, or IE9+
	if ( 'onwheel' in document || document.documentMode >= 9 ) {


		mousewheel = function ( node, fire ) {
			var handler = function ( event ) {
				var pixelScale = 1;

				if ( event.deltaMode === event.DOM_DELTA_LINE ) {
					pixelScale = 40;
				}

				fire({
					node: this,
					original: event,
					dx: event.deltaX * -pixelScale,
					dy: event.deltaY * -pixelScale
				});
			};

			node.addEventListener( 'wheel', handler, false );

			return {
				teardown: function () {
					node.removeEventListener( 'wheel', handler, false );
				}
			};
		};
	}

	//
	else {
		events = [ 'mousewheel', 'DOMMouseScroll', 'MozMousePixelScroll' ];

		mousewheel = function ( node, fire ) {
			var i, handler = function ( event ) {
				var delta, deltaX, deltaY;

				delta = deltaX = deltaY = 0;

				// Old school scrollwheel delta
				if ( event.wheelDelta ) { delta = event.wheelDelta; }
				if ( event.detail )	 { delta = event.detail * -1; }

				// At a minimum, setup the deltaY to be delta
				deltaY = delta;

				// Firefox < 17 related to DOMMouseScroll event
				if ( event.axis !== undefined && event.axis === event.HORIZONTAL_AXIS ) {
					deltaY = 0;
					deltaX = delta * -1;
				}

				// Webkit
				if ( event.wheelDeltaY !== undefined ) { deltaY = event.wheelDeltaY / 3; }
				if ( event.wheelDeltaX !== undefined ) { deltaX = event.wheelDeltaX / 3; }

				fire({
					node: this,
					original: event,
					dx: deltaX,
					dy: deltaY
				});
			};

			i = events.length;
			while ( i-- ) {
				node.addEventListener( events[i], handler, false );
			}

			return {
				teardown: function () {
					var i = events.length;
					while ( i-- ) {
						node.removeEventListener( events[i], handler, false );
					}
				}
			};
		};
	}

	Ractive.events.mousewheel = mousewheel;

}));
