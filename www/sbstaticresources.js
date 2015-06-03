
var activeOrientation = 'default';

var sbstaticresources = function(){

};

sbstaticresources.prototype = {
  version: 6000,
  //  cordova.exec(null, null, 'sbstaticresources', 'lockOrientation', [activeOrientation]);
};

var plugin = new sbstaticresources();

module.exports = plugin;