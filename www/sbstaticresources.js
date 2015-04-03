
var activeOrientation = 'default';

var sbstaticresources = function(){

};

sbstaticresources.prototype = {
  version: 5500,
  //  cordova.exec(null, null, 'sbstaticresources', 'lockOrientation', [activeOrientation]);
};

var plugin = new sbstaticresources();

module.exports = plugin;