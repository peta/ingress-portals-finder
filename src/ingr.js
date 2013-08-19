var ck = document.cookie.match(/(^|;)\s*csrftoken=([^\s;]+)/i)
  , token = ck && ck[2] || ''
  , api = "//www.ingress.com/rpc/dashboard.getThinnedEntitiesV4"
  , qk = '0_2_6'
  , param = {
    "boundsParamsList" : [],
    "method": "dashboard.getThinnedEntitiesV4"
  };

var port = chrome.extension.connect({name: "ingress-air"})
  , ready = true;

port.onMessage.addListener(function(bounds){
  ready = true;
  if( /-?[\.\d]+,-?[\.\d]+,-?[\.\d]+,-?[\.\d]+@\d+/.test( bounds ) ) {
    if( !token ) {
      var ck = document.cookie.match(/(^|;)\s*csrftoken=([^\s;]+)/i);
      token = ck && ck[2] || '';
      if( token )
        xhr.setRequestHeader("X-CSRFToken", token);
    }
    
    if( !token ) {
      return port.postMessage('NOAUTH');
    }
    ingr( bounds );
  } else {
    port.postMessage('INVALID');
  }
});

port.onDisconnect.addListener(function(){
  ready = false;
});

var result = {};

var IPF = IPF || {};
IPF.MapTools = {
	lngToTile: function(lng, zoom) {
	  return Math.floor((lng + 180) / 360 * Math.pow(2, (zoom>12)?zoom:(zoom+2)));
	},
	latToTile: function(lat, zoom) {
	  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) +
	    1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, (zoom>12)?zoom:(zoom+2)));
	},
	tileToLng: function(x, zoom) {
	  return x / Math.pow(2, (zoom>12)?zoom:(zoom+2)) * 360 - 180;
	},
	tileToLat: function(y, zoom) {
	  var n = Math.PI - 2 * Math.PI * y / Math.pow(2,  (zoom>12)?zoom:(zoom+2));
	  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
	},
	pointToTileId: function(zoom, x, y) {
	  return zoom + "_" + x + "_" + y;
	},
	generateBoundsParams: function(tile_id, minLat, minLng, maxLat, maxLng) {
	  return {
	    id: tile_id,
	    qk: tile_id,
	    minLatE6: Math.round(minLat * 1E6),
	    minLngE6: Math.round(minLng * 1E6),
	    maxLatE6: Math.round(maxLat * 1E6),
	    maxLngE6: Math.round(maxLng * 1E6)
	  };
	},
	boundsToTileObjs: function(zoom, bounds) {
		zoom = ~~(zoom);

	  	var x1 = this.lngToTile(parseFloat(bounds[1]), zoom),
	  		x2 = this.lngToTile(parseFloat(bounds[3]), zoom),
	  		y1 = this.latToTile(parseFloat(bounds[2]), zoom),
	  		y2 = this.latToTile(parseFloat(bounds[0]), zoom);
		
		var paramObjs = [];
		for (var y = y1; y <= y2; y++) {
			for (var x = x1; x <= x2; x++) {				
				paramObjs.push(this.generateBoundsParams(					
					this.pointToTileId(zoom, x, y), // tile_id
					this.tileToLat(y, zoom), 	    // latSouth
					this.tileToLat(y + 1, zoom),    // lngWest
					this.tileToLng(x, zoom),        // latNorth
					this.tileToLng(x + 1, zoom)     // lngEas
				));
			}
		}

		return paramObjs;
	}
};


var xhr = new XMLHttpRequest();
xhr.onreadystatechange = function(){
  if (xhr.readyState == 4) {	  
    if( !ready && xhr.status != 200 || this.repsonseText == 'User not authenticated' ) // failed
      return port.postMessage('NOAUTH');

    var c = ''
      , resp;
    try {
      resp = JSON.parse(this.responseText);
    } catch(e){}
    if( !resp || resp.error || !resp.result || !Object.keys(resp.result.map).length ) {
      return port.postMessage('FAILED');
    }
	
	// Instead of a single tile data object, since V3 we may have multiple ones.
	// So we simply merge all entities into a single array
	
	var gameEntities = [],
		delEntities = [],
		tileId,
		tileObj,
		nEntities;
	
	for (tileId in resp.result.map) {
		tileObj = resp.result.map[tileId];
		if (tileObj.gameEntities) {			
			nEntities = tileObj.gameEntities.length;
			gameEntities = gameEntities.concat(tileObj.gameEntities);
		} else {
			nEntities = 'no';
		}
		if (tileObj.deletedGameEntityGuids && tileObj.deletedGameEntityGuids.length) {
			delEntities = delEntities.concat(tileObj.deletedGameEntityGuids);
		}
		console.log('[Fix] Found '+nEntities+' game entities in tile "'+tileId+'"');
	}
	
	console.log('[Fix] Found '+gameEntities.length+' game entities in total', gameEntities);
    port.postMessage({
    	deletedGameEntityGuids: delEntities,
		gameEntities: gameEntities
    });
  }
};

function ingr(bounds) {
  if( xhr.readyState && xhr.readyState != 4 ) {
    xhr.abort();
  }
  result = {};
  port.postMessage('QUERYING');

  xhr.open("POST", api, true);
  xhr.setRequestHeader("X-CSRFToken", token);

  // Build tile param objects used to query data
  
  // Chop off zoom level and prepare boundary coords
  var tmp = bounds.split('@'),
      tmpBounds = tmp[0].split(','),
      zoom = ~~(tmp[1]);
  // Generate tile param objects
  param.boundsParamsList = IPF.MapTools.boundsToTileObjs(zoom || 16, tmpBounds);  
  console.log('[Fix] Generated tile objects', param.boundsParamsList);

  xhr.withCredentials = true;
  xhr.send( JSON.stringify(param) );
};
