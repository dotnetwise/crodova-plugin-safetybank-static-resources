
var activeOrientation = 'default';

var sbstaticresources = function(){

};

sbstaticresources.prototype = {
  version: 6100,
  //  cordova.exec(null, null, 'sbstaticresources', 'lockOrientation', [activeOrientation]);
};

var plugin = new sbstaticresources();

module.exports = plugin;
