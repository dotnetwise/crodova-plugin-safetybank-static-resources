/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
	if (typeof requirejs != 'undefined') {
		return;
	}
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define('knockout', [],function () { return window.ko; });
// Domain Public by Eric Wendelin http://eriwen.com/ (2008)
//                  Luke Smith http://lucassmith.name/ (2008)
//                  Loic Dachary <loic@dachary.org> (2008)
//                  Johan Euphrosine <proppy@aminche.com> (2008)
//                  Oyvind Sean Kinsey http://kinsey.no/blog (2010)
//                  Victor Homyakov <victor-homyakov@users.sourceforge.net> (2010)
 
/** 
 * Main function giving a function stack trace with a forced or passed in Error
 *
 * @cfg {Error} e The error to create a stacktrace from (optional)
 * @cfg {Boolean} guess If we should try to resolve the names of anonymous functions
 * @return {Array} of Strings with functions, lines, files, and arguments where possible
 */
function printStackTrace(options) {
	options = options || { guess: true };
	var ex = options.e || null, guess = !!options.guess;
	var p = new printStackTrace.implementation(), result = p.run(ex);
	return (guess) ? p.guessAnonymousFunctions(result) : result;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = printStackTrace;
}

printStackTrace.implementation = function () {
};

printStackTrace.implementation.prototype = {
	/**
     * @param {Error} ex The error to create a stacktrace from (optional)
     * @param {String} mode Forced mode (optional, mostly for unit tests)
     */
	run: function (ex, mode) {
		ex = ex || this.createException();
		// examine exception properties w/o debugger
		//for (var prop in ex) {alert("Ex['" + prop + "']=" + ex[prop]);}
		mode = mode || this.mode(ex);
		if (mode === 'other') {
			return this.other(arguments.callee);
		} else {
			return this[mode](ex);
		}
	},

	createException: function () {
		try {
			this.undef();
		} catch (e) {
			return e;
		}
	},

	/**
     * Mode could differ for different exception, e.g.
     * exceptions in Chrome may or may not have arguments or stack.
     *
     * @return {String} mode of operation for the exception
     */
	mode: function (e) {
		if (e['arguments'] && e.stack) {
			return 'chrome';
		} else if (e.stack && e.sourceURL) {
			return 'safari';
		} else if (e.stack && e.number) {
			return 'ie';
		} else if (typeof e.message === 'string' && typeof window !== 'undefined' && window.opera) {
			// e.message.indexOf("Backtrace:") > -1 -> opera
			// !e.stacktrace -> opera
			if (!e.stacktrace) {
				return 'opera9'; // use e.message
			}
			// 'opera#sourceloc' in e -> opera9, opera10a
			if (e.message.indexOf('\n') > -1 && e.message.split('\n').length > e.stacktrace.split('\n').length) {
				return 'opera9'; // use e.message
			}
			// e.stacktrace && !e.stack -> opera10a
			if (!e.stack) {
				return 'opera10a'; // use e.stacktrace
			}
			// e.stacktrace && e.stack -> opera10b
			if (e.stacktrace.indexOf("called from line") < 0) {
				return 'opera10b'; // use e.stacktrace, format differs from 'opera10a'
			}
			// e.stacktrace && e.stack -> opera11
			return 'opera11'; // use e.stacktrace, format differs from 'opera10a', 'opera10b'
		} else if (e.stack) {
			return 'firefox';
		}
		return 'other';
	},

	/**
     * Given a context, function name, and callback function, overwrite it so that it calls
     * printStackTrace() first with a callback and then runs the rest of the body.
     *
     * @param {Object} context of execution (e.g. window)
     * @param {String} functionName to instrument
     * @param {Function} function to call with a stack trace on invocation
     */
	instrumentFunction: function (context, functionName, callback) {
		context = context || window;
		var original = context[functionName];
		context[functionName] = function instrumented() {
			callback.call(this, printStackTrace().slice(4));
			return context[functionName]._instrumented.apply(this, arguments);
		};
		context[functionName]._instrumented = original;
	},

	/**
     * Given a context and function name of a function that has been
     * instrumented, revert the function to it's original (non-instrumented)
     * state.
     *
     * @param {Object} context of execution (e.g. window)
     * @param {String} functionName to de-instrument
     */
	deinstrumentFunction: function (context, functionName) {
		if (context[functionName].constructor === Function &&
                context[functionName]._instrumented &&
                context[functionName]._instrumented.constructor === Function) {
			context[functionName] = context[functionName]._instrumented;
		}
	},

	/**
     * Given an Error object, return a formatted Array based on Chrome's stack string.
     *
     * @param e - Error object to inspect
     * @return Array<String> of function calls, files and line numbers
     */
	chrome: function (e) {
		var stack = (e.stack + '\n').replace(/^\S[^\(]+?[\n$]/gm, '').
          replace(/^\s+(at eval )?at\s+/gm, '').
          replace(/^([^\(]+?)([\n$])/gm, '{anonymous}()@$1$2').
          replace(/^Object.<anonymous>\s*\(([^\)]+)\)/gm, '{anonymous}()@$1').split('\n');
		stack.pop();
		return stack;
	},

	/**
     * Given an Error object, return a formatted Array based on Safari's stack string.
     *
     * @param e - Error object to inspect
     * @return Array<String> of function calls, files and line numbers
     */
	safari: function (e) {
		return e.stack.replace(/\[native code\]\n/m, '')
            .replace(/^(?=\w+Error\:).*$\n/m, '')
            .replace(/^@/gm, '{anonymous}()@')
            .split('\n');
	},

	/**
     * Given an Error object, return a formatted Array based on IE's stack string.
     *
     * @param e - Error object to inspect
     * @return Array<String> of function calls, files and line numbers
     */
	ie: function (e) {
		var lineRE = /^.*at (\w+) \(([^\)]+)\)$/gm;
		return e.stack.replace(/at Anonymous function /gm, '{anonymous}()@')
            .replace(/^(?=\w+Error\:).*$\n/m, '')
            .replace(lineRE, '$1@$2')
            .split('\n');
	},

	/**
     * Given an Error object, return a formatted Array based on Firefox's stack string.
     *
     * @param e - Error object to inspect
     * @return Array<String> of function calls, files and line numbers
     */
	firefox: function (e) {
		return e.stack.replace(/(?:\n@:0)?\s+$/m, '').replace(/^[\(@]/gm, '{anonymous}()@').split('\n');
	},

	opera11: function (e) {
		var ANON = '{anonymous}', lineRE = /^.*line (\d+), column (\d+)(?: in (.+))? in (\S+):$/;
		var lines = e.stacktrace.split('\n'), result = [];

		for (var i = 0, len = lines.length; i < len; i += 2) {
			var match = lineRE.exec(lines[i]);
			if (match) {
				var location = match[4] + ':' + match[1] + ':' + match[2];
				var fnName = match[3] || "global code";
				fnName = fnName.replace(/<anonymous function: (\S+)>/, "$1").replace(/<anonymous function>/, ANON);
				result.push(fnName + '@' + location + ' -- ' + lines[i + 1].replace(/^\s+/, ''));
			}
		}

		return result;
	},

	opera10b: function (e) {
		// "<anonymous function: run>([arguments not available])@file://localhost/G:/js/stacktrace.js:27\n" +
		// "printStackTrace([arguments not available])@file://localhost/G:/js/stacktrace.js:18\n" +
		// "@file://localhost/G:/js/test/functional/testcase1.html:15"
		var lineRE = /^(.*)@(.+):(\d+)$/;
		var lines = e.stacktrace.split('\n'), result = [];

		for (var i = 0, len = lines.length; i < len; i++) {
			var match = lineRE.exec(lines[i]);
			if (match) {
				var fnName = match[1] ? (match[1] + '()') : "global code";
				result.push(fnName + '@' + match[2] + ':' + match[3]);
			}
		}

		return result;
	},

	/**
     * Given an Error object, return a formatted Array based on Opera 10's stacktrace string.
     *
     * @param e - Error object to inspect
     * @return Array<String> of function calls, files and line numbers
     */
	opera10a: function (e) {
		// "  Line 27 of linked script file://localhost/G:/js/stacktrace.js\n"
		// "  Line 11 of inline#1 script in file://localhost/G:/js/test/functional/testcase1.html: In function foo\n"
		var ANON = '{anonymous}', lineRE = /Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i;
		var lines = e.stacktrace.split('\n'), result = [];

		for (var i = 0, len = lines.length; i < len; i += 2) {
			var match = lineRE.exec(lines[i]);
			if (match) {
				var fnName = match[3] || ANON;
				result.push(fnName + '()@' + match[2] + ':' + match[1] + ' -- ' + lines[i + 1].replace(/^\s+/, ''));
			}
		}

		return result;
	},

	// Opera 7.x-9.2x only!
	opera9: function (e) {
		// "  Line 43 of linked script file://localhost/G:/js/stacktrace.js\n"
		// "  Line 7 of inline#1 script in file://localhost/G:/js/test/functional/testcase1.html\n"
		var ANON = '{anonymous}', lineRE = /Line (\d+).*script (?:in )?(\S+)/i;
		var lines = e.message.split('\n'), result = [];

		for (var i = 2, len = lines.length; i < len; i += 2) {
			var match = lineRE.exec(lines[i]);
			if (match) {
				result.push(ANON + '()@' + match[2] + ':' + match[1] + ' -- ' + lines[i + 1].replace(/^\s+/, ''));
			}
		}

		return result;
	},

	// Safari 5-, IE 9-, and others
	other: function (curr) {
		var ANON = '{anonymous}', fnRE = /function\s*([\w\-$]+)?\s*\(/i, stack = [], fn, args, maxStackSize = 10;
		while (curr && curr['arguments'] && stack.length < maxStackSize) {
			fn = fnRE.test(curr.toString()) ? RegExp.$1 || ANON : ANON;
			args = Array.prototype.slice.call(curr['arguments'] || []);
			stack[stack.length] = fn + '(' + this.stringifyArguments(args) + ')';
			curr = curr.caller;
		}
		return stack;
	},

	/**
     * Given arguments array as a String, subsituting type names for non-string types.
     *
     * @param {Arguments} args
     * @return {Array} of Strings with stringified arguments
     */
	stringifyArguments: function (args) {
		var result = [];
		var slice = Array.prototype.slice;
		for (var i = 0; i < args.length; ++i) {
			var arg = args[i];
			if (arg === undefined) {
				result[i] = 'undefined';
			} else if (arg === null) {
				result[i] = 'null';
			} else if (arg.constructor) {
				if (arg.constructor === Array) {
					if (arg.length < 3) {
						result[i] = '[' + this.stringifyArguments(arg) + ']';
					} else {
						result[i] = '[' + this.stringifyArguments(slice.call(arg, 0, 1)) + '...' + this.stringifyArguments(slice.call(arg, -1)) + ']';
					}
				} else if (arg.constructor === Object) {
					result[i] = '#object';
				} else if (arg.constructor === Function) {
					result[i] = '#function';
				} else if (arg.constructor === String) {
					result[i] = '"' + arg + '"';
				} else if (arg.constructor === Number) {
					result[i] = arg;
				}
			}
		}
		return result.join(',');
	},

	sourceCache: {},

	/**
     * @return the text from a given URL
     */
	ajax: function (url) {
		var req = this.createXMLHTTPObject();
		if (req) {
			try {
				req.open('GET', url, false);
				//req.overrideMimeType('text/plain');
				//req.overrideMimeType('text/javascript');
				req.send(null);
				//return req.status == 200 ? req.responseText : '';
				return req.responseText;
			} catch (e) {
			}
		}
		return '';
	},

	/**
     * Try XHR methods in order and store XHR factory.
     *
     * @return <Function> XHR function or equivalent
     */
	createXMLHTTPObject: function () {
		var xmlhttp, XMLHttpFactories = [
            function () {
            	return new XMLHttpRequest();
            }, function () {
            	return new ActiveXObject('Msxml2.XMLHTTP');
            }, function () {
            	return new ActiveXObject('Msxml3.XMLHTTP');
            }, function () {
            	return new ActiveXObject('Microsoft.XMLHTTP');
            }
		];
		for (var i = 0; i < XMLHttpFactories.length; i++) {
			try {
				xmlhttp = XMLHttpFactories[i]();
				// Use memoization to cache the factory
				this.createXMLHTTPObject = XMLHttpFactories[i];
				return xmlhttp;
			} catch (e) {
			}
		}
	},

	/**
     * Given a URL, check if it is in the same domain (so we can get the source
     * via Ajax).
     *
     * @param url <String> source url
     * @return False if we need a cross-domain request
     */
	isSameDomain: function (url) {
		return typeof location !== "undefined" && url.indexOf(location.hostname) !== -1; // location may not be defined, e.g. when running from nodejs.
	},

	/**
     * Get source code from given URL if in the same domain.
     *
     * @param url <String> JS source URL
     * @return <Array> Array of source code lines
     */
	getSource: function (url) {
		// TODO reuse source from script tags?
		if (!(url in this.sourceCache)) {
			this.sourceCache[url] = this.ajax(url).split('\n');
		}
		return this.sourceCache[url];
	},

	guessAnonymousFunctions: function (stack) {
		for (var i = 0; i < stack.length; ++i) {
			var reStack = /\{anonymous\}\(.*\)@(.*)/,
                reRef = /^(.*?)(?::(\d+))(?::(\d+))?(?: -- .+)?$/,
                frame = stack[i], ref = reStack.exec(frame);

			if (ref) {
				var m = reRef.exec(ref[1]);
				if (m) { // If falsey, we did not get any file/line information
					var file = m[1], lineno = m[2], charno = m[3] || 0;
					if (file && this.isSameDomain(file) && lineno) {
						var functionName = this.guessAnonymousFunction(file, lineno, charno);
						stack[i] = frame.replace('{anonymous}', functionName);
					}
				}
			}
		}
		return stack;
	},

	guessAnonymousFunction: function (url, lineNo, charNo) {
		var ret;
		try {
			ret = this.findFunctionName(this.getSource(url), lineNo);
		} catch (e) {
			ret = 'getSource failed with url: ' + url + ', exception: ' + e.toString();
		}
		return ret;
	},

	findFunctionName: function (source, lineNo) {
		// FIXME findFunctionName fails for compressed source
		// (more than one function on the same line)
		// function {name}({args}) m[1]=name m[2]=args
		var reFunctionDeclaration = /function\s+([^(]*?)\s*\(([^)]*)\)/;
		// {name} = function ({args}) TODO args capture
		// /['"]?([0-9A-Za-z_]+)['"]?\s*[:=]\s*function(?:[^(]*)/
		var reFunctionExpression = /['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*function\b/;
		// {name} = eval()
		var reFunctionEvaluation = /['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*(?:eval|new Function)\b/;
		// Walk backwards in the source lines until we find
		// the line which matches one of the patterns above
		var code = "", line, maxLines = Math.min(lineNo, 20), m, commentPos;
		for (var i = 0; i < maxLines; ++i) {
			// lineNo is 1-based, source[] is 0-based
			line = source[lineNo - i - 1];
			commentPos = line.indexOf('//');
			if (commentPos >= 0) {
				line = line.substr(0, commentPos);
			}
			// TODO check other types of comments? Commented code may lead to false positive
			if (line) {
				code = line + code;
				m = reFunctionExpression.exec(code);
				if (m && m[1]) {
					return m[1];
				}
				m = reFunctionDeclaration.exec(code);
				if (m && m[1]) {
					//return m[1] + "(" + (m[2] || "") + ")";
					return m[1];
				}
				m = reFunctionEvaluation.exec(code);
				if (m && m[1]) {
					return m[1];
				}
			}
		}
		return '(?)';
	}
};

(function () {
	var errorForm, error, stack;
	window.appConfig = window.appConfig || {};
	if (/^https/i.test(location.protocol))
		appConfig.ssl = true;
	window.elmah = function (e) {
		if (window.QUnit) return;
		var trace = printStackTrace({ e: e });
		if (!errorForm) {
			var frame = document.createElement('IFRAME');
			var dom = document.body || document.documentElement;
			frame.name = 'ELMAH';
			frame.style.display = 'none';
			errorForm = document.createElement('FORM');
			errorForm.target = 'ELMAH';
			errorForm.method = 'POST';
			error = document.createElement('INPUT');
			stack = document.createElement('INPUT');
			error.name = 'error';
			error.type = 'hidden';
			stack.name = 'stack';
			stack.type = 'hidden';
			errorForm.appendChild(error);
			errorForm.appendChild(stack);
			dom.appendChild(frame);
			dom.appendChild(errorForm);
		}
		if (e) {
			if (e.requireModules) {
				trace.unshift('');
				trace.unshift('];');
				(e.requireModules || "").toString().split(' ').forEach(function (module) {
					trace.unshift('   <b>aa</b>' + module);
				});
				trace.unshift('requireModules: [');
			}
			if (e.requireType) {
				trace.unshift('requireType: ' + e.requireType);
			}
		}
		stack.value = trace.join('\n');
		errorForm.action = [appConfig.ssl ? 'https://' : 'http://', appConfig.domain, "/en/Home/RecordClientError"].join('');
		error.value = e && (e.message || e.description || e);
		errorForm.submit();
		return new Error(e);
	}
})();
/* Modernizr 2.8.3 (Custom Build) | MIT & BSD
 * Build: http://modernizr.com/download/#-csstransforms-csstransforms3d-csstransitions-shiv-cssclasses-teststyles-testprop-testallprops-prefixes-domprefixes-load
 */
;window.Modernizr=function(a,b,c){function z(a){j.cssText=a}function A(a,b){return z(m.join(a+";")+(b||""))}function B(a,b){return typeof a===b}function C(a,b){return!!~(""+a).indexOf(b)}function D(a,b){for(var d in a){var e=a[d];if(!C(e,"-")&&j[e]!==c)return b=="pfx"?e:!0}return!1}function E(a,b,d){for(var e in a){var f=b[a[e]];if(f!==c)return d===!1?a[e]:B(f,"function")?f.bind(d||b):f}return!1}function F(a,b,c){var d=a.charAt(0).toUpperCase()+a.slice(1),e=(a+" "+o.join(d+" ")+d).split(" ");return B(b,"string")||B(b,"undefined")?D(e,b):(e=(a+" "+p.join(d+" ")+d).split(" "),E(e,b,c))}var d="2.8.3",e={},f=!0,g=b.documentElement,h="modernizr",i=b.createElement(h),j=i.style,k,l={}.toString,m=" -webkit- -moz- -o- -ms- ".split(" "),n="Webkit Moz O ms",o=n.split(" "),p=n.toLowerCase().split(" "),q={},r={},s={},t=[],u=t.slice,v,w=function(a,c,d,e){var f,i,j,k,l=b.createElement("div"),m=b.body,n=m||b.createElement("body");if(parseInt(d,10))while(d--)j=b.createElement("div"),j.id=e?e[d]:h+(d+1),l.appendChild(j);return f=["&#173;",'<style id="s',h,'">',a,"</style>"].join(""),l.id=h,(m?l:n).innerHTML+=f,n.appendChild(l),m||(n.style.background="",n.style.overflow="hidden",k=g.style.overflow,g.style.overflow="hidden",g.appendChild(n)),i=c(l,a),m?l.parentNode.removeChild(l):(n.parentNode.removeChild(n),g.style.overflow=k),!!i},x={}.hasOwnProperty,y;!B(x,"undefined")&&!B(x.call,"undefined")?y=function(a,b){return x.call(a,b)}:y=function(a,b){return b in a&&B(a.constructor.prototype[b],"undefined")},Function.prototype.bind||(Function.prototype.bind=function(b){var c=this;if(typeof c!="function")throw new TypeError;var d=u.call(arguments,1),e=function(){if(this instanceof e){var a=function(){};a.prototype=c.prototype;var f=new a,g=c.apply(f,d.concat(u.call(arguments)));return Object(g)===g?g:f}return c.apply(b,d.concat(u.call(arguments)))};return e}),q.csstransforms=function(){return!!F("transform")},q.csstransforms3d=function(){var a=!!F("perspective");return a&&"webkitPerspective"in g.style&&w("@media (transform-3d),(-webkit-transform-3d){#modernizr{left:9px;position:absolute;height:3px;}}",function(b,c){a=b.offsetLeft===9&&b.offsetHeight===3}),a},q.csstransitions=function(){return F("transition")};for(var G in q)y(q,G)&&(v=G.toLowerCase(),e[v]=q[G](),t.push((e[v]?"":"no-")+v));return e.addTest=function(a,b){if(typeof a=="object")for(var d in a)y(a,d)&&e.addTest(d,a[d]);else{a=a.toLowerCase();if(e[a]!==c)return e;b=typeof b=="function"?b():b,typeof f!="undefined"&&f&&(g.className+=" "+(b?"":"no-")+a),e[a]=b}return e},z(""),i=k=null,function(a,b){function l(a,b){var c=a.createElement("p"),d=a.getElementsByTagName("head")[0]||a.documentElement;return c.innerHTML="x<style>"+b+"</style>",d.insertBefore(c.lastChild,d.firstChild)}function m(){var a=s.elements;return typeof a=="string"?a.split(" "):a}function n(a){var b=j[a[h]];return b||(b={},i++,a[h]=i,j[i]=b),b}function o(a,c,d){c||(c=b);if(k)return c.createElement(a);d||(d=n(c));var g;return d.cache[a]?g=d.cache[a].cloneNode():f.test(a)?g=(d.cache[a]=d.createElem(a)).cloneNode():g=d.createElem(a),g.canHaveChildren&&!e.test(a)&&!g.tagUrn?d.frag.appendChild(g):g}function p(a,c){a||(a=b);if(k)return a.createDocumentFragment();c=c||n(a);var d=c.frag.cloneNode(),e=0,f=m(),g=f.length;for(;e<g;e++)d.createElement(f[e]);return d}function q(a,b){b.cache||(b.cache={},b.createElem=a.createElement,b.createFrag=a.createDocumentFragment,b.frag=b.createFrag()),a.createElement=function(c){return s.shivMethods?o(c,a,b):b.createElem(c)},a.createDocumentFragment=Function("h,f","return function(){var n=f.cloneNode(),c=n.createElement;h.shivMethods&&("+m().join().replace(/[\w\-]+/g,function(a){return b.createElem(a),b.frag.createElement(a),'c("'+a+'")'})+");return n}")(s,b.frag)}function r(a){a||(a=b);var c=n(a);return s.shivCSS&&!g&&!c.hasCSS&&(c.hasCSS=!!l(a,"article,aside,dialog,figcaption,figure,footer,header,hgroup,main,nav,section{display:block}mark{background:#FF0;color:#000}template{display:none}")),k||q(a,c),a}var c="3.7.0",d=a.html5||{},e=/^<|^(?:button|map|select|textarea|object|iframe|option|optgroup)$/i,f=/^(?:a|b|code|div|fieldset|h1|h2|h3|h4|h5|h6|i|label|li|ol|p|q|span|strong|style|table|tbody|td|th|tr|ul)$/i,g,h="_html5shiv",i=0,j={},k;(function(){try{var a=b.createElement("a");a.innerHTML="<xyz></xyz>",g="hidden"in a,k=a.childNodes.length==1||function(){b.createElement("a");var a=b.createDocumentFragment();return typeof a.cloneNode=="undefined"||typeof a.createDocumentFragment=="undefined"||typeof a.createElement=="undefined"}()}catch(c){g=!0,k=!0}})();var s={elements:d.elements||"abbr article aside audio bdi canvas data datalist details dialog figcaption figure footer header hgroup main mark meter nav output progress section summary template time video",version:c,shivCSS:d.shivCSS!==!1,supportsUnknownElements:k,shivMethods:d.shivMethods!==!1,type:"default",shivDocument:r,createElement:o,createDocumentFragment:p};a.html5=s,r(b)}(this,b),e._version=d,e._prefixes=m,e._domPrefixes=p,e._cssomPrefixes=o,e.testProp=function(a){return D([a])},e.testAllProps=F,e.testStyles=w,g.className=g.className.replace(/(^|\s)no-js(\s|$)/,"$1$2")+(f?" js "+t.join(" "):""),e}(this,this.document),function(a,b,c){function d(a){return"[object Function]"==o.call(a)}function e(a){return"string"==typeof a}function f(){}function g(a){return!a||"loaded"==a||"complete"==a||"uninitialized"==a}function h(){var a=p.shift();q=1,a?a.t?m(function(){("c"==a.t?B.injectCss:B.injectJs)(a.s,0,a.a,a.x,a.e,1)},0):(a(),h()):q=0}function i(a,c,d,e,f,i,j){function k(b){if(!o&&g(l.readyState)&&(u.r=o=1,!q&&h(),l.onload=l.onreadystatechange=null,b)){"img"!=a&&m(function(){t.removeChild(l)},50);for(var d in y[c])y[c].hasOwnProperty(d)&&y[c][d].onload()}}var j=j||B.errorTimeout,l=b.createElement(a),o=0,r=0,u={t:d,s:c,e:f,a:i,x:j};1===y[c]&&(r=1,y[c]=[]),"object"==a?l.data=c:(l.src=c,l.type=a),l.width=l.height="0",l.onerror=l.onload=l.onreadystatechange=function(){k.call(this,r)},p.splice(e,0,u),"img"!=a&&(r||2===y[c]?(t.insertBefore(l,s?null:n),m(k,j)):y[c].push(l))}function j(a,b,c,d,f){return q=0,b=b||"j",e(a)?i("c"==b?v:u,a,b,this.i++,c,d,f):(p.splice(this.i++,0,a),1==p.length&&h()),this}function k(){var a=B;return a.loader={load:j,i:0},a}var l=b.documentElement,m=a.setTimeout,n=b.getElementsByTagName("script")[0],o={}.toString,p=[],q=0,r="MozAppearance"in l.style,s=r&&!!b.createRange().compareNode,t=s?l:n.parentNode,l=a.opera&&"[object Opera]"==o.call(a.opera),l=!!b.attachEvent&&!l,u=r?"object":l?"script":"img",v=l?"script":u,w=Array.isArray||function(a){return"[object Array]"==o.call(a)},x=[],y={},z={timeout:function(a,b){return b.length&&(a.timeout=b[0]),a}},A,B;B=function(a){function b(a){var a=a.split("!"),b=x.length,c=a.pop(),d=a.length,c={url:c,origUrl:c,prefixes:a},e,f,g;for(f=0;f<d;f++)g=a[f].split("="),(e=z[g.shift()])&&(c=e(c,g));for(f=0;f<b;f++)c=x[f](c);return c}function g(a,e,f,g,h){var i=b(a),j=i.autoCallback;i.url.split(".").pop().split("?").shift(),i.bypass||(e&&(e=d(e)?e:e[a]||e[g]||e[a.split("/").pop().split("?")[0]]),i.instead?i.instead(a,e,f,g,h):(y[i.url]?i.noexec=!0:y[i.url]=1,f.load(i.url,i.forceCSS||!i.forceJS&&"css"==i.url.split(".").pop().split("?").shift()?"c":c,i.noexec,i.attrs,i.timeout),(d(e)||d(j))&&f.load(function(){k(),e&&e(i.origUrl,h,g),j&&j(i.origUrl,h,g),y[i.url]=2})))}function h(a,b){function c(a,c){if(a){if(e(a))c||(j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}),g(a,j,b,0,h);else if(Object(a)===a)for(n in m=function(){var b=0,c;for(c in a)a.hasOwnProperty(c)&&b++;return b}(),a)a.hasOwnProperty(n)&&(!c&&!--m&&(d(j)?j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}:j[n]=function(a){return function(){var b=[].slice.call(arguments);a&&a.apply(this,b),l()}}(k[n])),g(a[n],j,b,n,h))}else!c&&l()}var h=!!a.test,i=a.load||a.both,j=a.callback||f,k=j,l=a.complete||f,m,n;c(h?a.yep:a.nope,!!i),i&&c(i)}var i,j,l=this.yepnope.loader;if(e(a))g(a,0,l,0);else if(w(a))for(i=0;i<a.length;i++)j=a[i],e(j)?g(j,0,l,0):w(j)?B(j):Object(j)===j&&h(j,l);else Object(a)===a&&h(a,l)},B.addPrefix=function(a,b){z[a]=b},B.addFilter=function(a){x.push(a)},B.errorTimeout=1e4,null==b.readyState&&b.addEventListener&&(b.readyState="loading",b.addEventListener("DOMContentLoaded",A=function(){b.removeEventListener("DOMContentLoaded",A,0),b.readyState="complete"},0)),a.yepnope=k(),a.yepnope.executeStack=h,a.yepnope.injectJs=function(a,c,d,e,i,j){var k=b.createElement("script"),l,o,e=e||B.errorTimeout;k.src=a;for(o in d)k.setAttribute(o,d[o]);c=j?h:c||f,k.onreadystatechange=k.onload=function(){!l&&g(k.readyState)&&(l=1,c(),k.onload=k.onreadystatechange=null)},m(function(){l||(l=1,c(1))},e),i?k.onload():n.parentNode.insertBefore(k,n)},a.yepnope.injectCss=function(a,c,d,e,g,i){var e=b.createElement("link"),j,c=i?h:c||f;e.href=a,e.rel="stylesheet",e.type="text/css";for(j in d)e.setAttribute(j,d[j]);g||(n.parentNode.insertBefore(e,n),m(c,0))}}(this,document),Modernizr.load=function(){yepnope.apply(window,[].slice.call(arguments,0))};
/*!
 * Bootstrap v3.1.1 (http://getbootstrap.com)
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 */
if("undefined"==typeof jQuery)throw new Error("Bootstrap's JavaScript requires jQuery");+function(a){function b(){var a=document.createElement("bootstrap"),b={WebkitTransition:"webkitTransitionEnd",MozTransition:"transitionend",OTransition:"oTransitionEnd otransitionend",transition:"transitionend"};for(var c in b)if(void 0!==a.style[c])return{end:b[c]};return!1}a.fn.emulateTransitionEnd=function(b){var c=!1,d=this;a(this).one(a.support.transition.end,function(){c=!0});var e=function(){c||a(d).trigger(a.support.transition.end)};return setTimeout(e,b),this},a(function(){a.support.transition=b()})}(jQuery),+function(a){var b='[data-dismiss="alert"]',c=function(c){a(c).on("click",b,this.close)};c.prototype.close=function(b){function c(){f.trigger("closed.bs.alert").remove()}var d=a(this),e=d.attr("data-target");e||(e=d.attr("href"),e=e&&e.replace(/.*(?=#[^\s]*$)/,""));var f=a(e);b&&b.preventDefault(),f.length||(f=d.hasClass("alert")?d:d.parent()),f.trigger(b=a.Event("close.bs.alert")),b.isDefaultPrevented()||(f.removeClass("in"),a.support.transition&&f.hasClass("fade")?f.one(a.support.transition.end,c).emulateTransitionEnd(150):c())};var d=a.fn.alert;a.fn.alert=function(b){return this.each(function(){var d=a(this),e=d.data("bs.alert");e||d.data("bs.alert",e=new c(this)),"string"==typeof b&&e[b].call(d)})},a.fn.alert.Constructor=c,a.fn.alert.noConflict=function(){return a.fn.alert=d,this},a(document).on("click.bs.alert.data-api",b,c.prototype.close)}(jQuery),+function(a){var b=function(c,d){this.$element=a(c),this.options=a.extend({},b.DEFAULTS,d),this.isLoading=!1};b.DEFAULTS={loadingText:"loading..."},b.prototype.setState=function(b){var c="disabled",d=this.$element,e=d.is("input")?"val":"html",f=d.data();b+="Text",f.resetText||d.data("resetText",d[e]()),d[e](f[b]||this.options[b]),setTimeout(a.proxy(function(){"loadingText"==b?(this.isLoading=!0,d.addClass(c).attr(c,c)):this.isLoading&&(this.isLoading=!1,d.removeClass(c).removeAttr(c))},this),0)},b.prototype.toggle=function(){var a=!0,b=this.$element.closest('[data-toggle="buttons"]');if(b.length){var c=this.$element.find("input");"radio"==c.prop("type")&&(c.prop("checked")&&this.$element.hasClass("active")?a=!1:b.find(".active").removeClass("active")),a&&c.prop("checked",!this.$element.hasClass("active")).trigger("change")}a&&this.$element.toggleClass("active")};var c=a.fn.button;a.fn.button=function(c){return this.each(function(){var d=a(this),e=d.data("bs.button"),f="object"==typeof c&&c;e||d.data("bs.button",e=new b(this,f)),"toggle"==c?e.toggle():c&&e.setState(c)})},a.fn.button.Constructor=b,a.fn.button.noConflict=function(){return a.fn.button=c,this},a(document).on("click.bs.button.data-api","[data-toggle^=button]",function(b){var c=a(b.target);c.hasClass("btn")||(c=c.closest(".btn")),c.button("toggle"),b.preventDefault()})}(jQuery),+function(a){var b=function(b,c){this.$element=a(b),this.$indicators=this.$element.find(".carousel-indicators"),this.options=c,this.paused=this.sliding=this.interval=this.$active=this.$items=null,"hover"==this.options.pause&&this.$element.on("mouseenter",a.proxy(this.pause,this)).on("mouseleave",a.proxy(this.cycle,this))};b.DEFAULTS={interval:5e3,pause:"hover",wrap:!0},b.prototype.cycle=function(b){return b||(this.paused=!1),this.interval&&clearInterval(this.interval),this.options.interval&&!this.paused&&(this.interval=setInterval(a.proxy(this.next,this),this.options.interval)),this},b.prototype.getActiveIndex=function(){return this.$active=this.$element.find(".item.active"),this.$items=this.$active.parent().children(),this.$items.index(this.$active)},b.prototype.to=function(b){var c=this,d=this.getActiveIndex();return b>this.$items.length-1||0>b?void 0:this.sliding?this.$element.one("slid.bs.carousel",function(){c.to(b)}):d==b?this.pause().cycle():this.slide(b>d?"next":"prev",a(this.$items[b]))},b.prototype.pause=function(b){return b||(this.paused=!0),this.$element.find(".next, .prev").length&&a.support.transition&&(this.$element.trigger(a.support.transition.end),this.cycle(!0)),this.interval=clearInterval(this.interval),this},b.prototype.next=function(){return this.sliding?void 0:this.slide("next")},b.prototype.prev=function(){return this.sliding?void 0:this.slide("prev")},b.prototype.slide=function(b,c){var d=this.$element.find(".item.active"),e=c||d[b](),f=this.interval,g="next"==b?"left":"right",h="next"==b?"first":"last",i=this;if(!e.length){if(!this.options.wrap)return;e=this.$element.find(".item")[h]()}if(e.hasClass("active"))return this.sliding=!1;var j=a.Event("slide.bs.carousel",{relatedTarget:e[0],direction:g});return this.$element.trigger(j),j.isDefaultPrevented()?void 0:(this.sliding=!0,f&&this.pause(),this.$indicators.length&&(this.$indicators.find(".active").removeClass("active"),this.$element.one("slid.bs.carousel",function(){var b=a(i.$indicators.children()[i.getActiveIndex()]);b&&b.addClass("active")})),a.support.transition&&this.$element.hasClass("slide")?(e.addClass(b),e[0].offsetWidth,d.addClass(g),e.addClass(g),d.one(a.support.transition.end,function(){e.removeClass([b,g].join(" ")).addClass("active"),d.removeClass(["active",g].join(" ")),i.sliding=!1,setTimeout(function(){i.$element.trigger("slid.bs.carousel")},0)}).emulateTransitionEnd(1e3*d.css("transition-duration").slice(0,-1))):(d.removeClass("active"),e.addClass("active"),this.sliding=!1,this.$element.trigger("slid.bs.carousel")),f&&this.cycle(),this)};var c=a.fn.carousel;a.fn.carousel=function(c){return this.each(function(){var d=a(this),e=d.data("bs.carousel"),f=a.extend({},b.DEFAULTS,d.data(),"object"==typeof c&&c),g="string"==typeof c?c:f.slide;e||d.data("bs.carousel",e=new b(this,f)),"number"==typeof c?e.to(c):g?e[g]():f.interval&&e.pause().cycle()})},a.fn.carousel.Constructor=b,a.fn.carousel.noConflict=function(){return a.fn.carousel=c,this},a(document).on("click.bs.carousel.data-api","[data-slide], [data-slide-to]",function(b){var c,d=a(this),e=a(d.attr("data-target")||(c=d.attr("href"))&&c.replace(/.*(?=#[^\s]+$)/,"")),f=a.extend({},e.data(),d.data()),g=d.attr("data-slide-to");g&&(f.interval=!1),e.carousel(f),(g=d.attr("data-slide-to"))&&e.data("bs.carousel").to(g),b.preventDefault()}),a(window).on("load",function(){a('[data-ride="carousel"]').each(function(){var b=a(this);b.carousel(b.data())})})}(jQuery),+function(a){var b=function(c,d){this.$element=a(c),this.options=a.extend({},b.DEFAULTS,d),this.transitioning=null,this.options.parent&&(this.$parent=a(this.options.parent)),this.options.toggle&&this.toggle()};b.DEFAULTS={toggle:!0},b.prototype.dimension=function(){var a=this.$element.hasClass("width");return a?"width":"height"},b.prototype.show=function(){if(!this.transitioning&&!this.$element.hasClass("in")){var b=a.Event("show.bs.collapse");if(this.$element.trigger(b),!b.isDefaultPrevented()){var c=this.$parent&&this.$parent.find("> .panel > .in");if(c&&c.length){var d=c.data("bs.collapse");if(d&&d.transitioning)return;c.collapse("hide"),d||c.data("bs.collapse",null)}var e=this.dimension();this.$element.removeClass("collapse").addClass("collapsing")[e](0),this.transitioning=1;var f=function(){this.$element.removeClass("collapsing").addClass("collapse in")[e]("auto"),this.transitioning=0,this.$element.trigger("shown.bs.collapse")};if(!a.support.transition)return f.call(this);var g=a.camelCase(["scroll",e].join("-"));this.$element.one(a.support.transition.end,a.proxy(f,this)).emulateTransitionEnd(350)[e](this.$element[0][g])}}},b.prototype.hide=function(){if(!this.transitioning&&this.$element.hasClass("in")){var b=a.Event("hide.bs.collapse");if(this.$element.trigger(b),!b.isDefaultPrevented()){var c=this.dimension();this.$element[c](this.$element[c]())[0].offsetHeight,this.$element.addClass("collapsing").removeClass("collapse").removeClass("in"),this.transitioning=1;var d=function(){this.transitioning=0,this.$element.trigger("hidden.bs.collapse").removeClass("collapsing").addClass("collapse")};return a.support.transition?void this.$element[c](0).one(a.support.transition.end,a.proxy(d,this)).emulateTransitionEnd(350):d.call(this)}}},b.prototype.toggle=function(){this[this.$element.hasClass("in")?"hide":"show"]()};var c=a.fn.collapse;a.fn.collapse=function(c){return this.each(function(){var d=a(this),e=d.data("bs.collapse"),f=a.extend({},b.DEFAULTS,d.data(),"object"==typeof c&&c);!e&&f.toggle&&"show"==c&&(c=!c),e||d.data("bs.collapse",e=new b(this,f)),"string"==typeof c&&e[c]()})},a.fn.collapse.Constructor=b,a.fn.collapse.noConflict=function(){return a.fn.collapse=c,this},a(document).on("click.bs.collapse.data-api","[data-toggle=collapse]",function(b){var c,d=a(this),e=d.attr("data-target")||b.preventDefault()||(c=d.attr("href"))&&c.replace(/.*(?=#[^\s]+$)/,""),f=a(e),g=f.data("bs.collapse"),h=g?"toggle":d.data(),i=d.attr("data-parent"),j=i&&a(i);g&&g.transitioning||(j&&j.find('[data-toggle=collapse][data-parent="'+i+'"]').not(d).addClass("collapsed"),d[f.hasClass("in")?"addClass":"removeClass"]("collapsed")),f.collapse(h)})}(jQuery),+function(a){function b(b){a(d).remove(),a(e).each(function(){var d=c(a(this)),e={relatedTarget:this};d.hasClass("open")&&(d.trigger(b=a.Event("hide.bs.dropdown",e)),b.isDefaultPrevented()||d.removeClass("open").trigger("hidden.bs.dropdown",e))})}function c(b){var c=b.attr("data-target");c||(c=b.attr("href"),c=c&&/#[A-Za-z]/.test(c)&&c.replace(/.*(?=#[^\s]*$)/,""));var d=c&&a(c);return d&&d.length?d:b.parent()}var d=".dropdown-backdrop",e="[data-toggle=dropdown]",f=function(b){a(b).on("click.bs.dropdown",this.toggle)};f.prototype.toggle=function(d){var e=a(this);if(!e.is(".disabled, :disabled")){var f=c(e),g=f.hasClass("open");if(b(),!g){"ontouchstart"in document.documentElement&&!f.closest(".navbar-nav").length&&a('<div class="dropdown-backdrop"/>').insertAfter(a(this)).on("click",b);var h={relatedTarget:this};if(f.trigger(d=a.Event("show.bs.dropdown",h)),d.isDefaultPrevented())return;f.toggleClass("open").trigger("shown.bs.dropdown",h),e.focus()}return!1}},f.prototype.keydown=function(b){if(/(38|40|27)/.test(b.keyCode)){var d=a(this);if(b.preventDefault(),b.stopPropagation(),!d.is(".disabled, :disabled")){var f=c(d),g=f.hasClass("open");if(!g||g&&27==b.keyCode)return 27==b.which&&f.find(e).focus(),d.click();var h=" li:not(.divider):visible a",i=f.find("[role=menu]"+h+", [role=listbox]"+h);if(i.length){var j=i.index(i.filter(":focus"));38==b.keyCode&&j>0&&j--,40==b.keyCode&&j<i.length-1&&j++,~j||(j=0),i.eq(j).focus()}}}};var g=a.fn.dropdown;a.fn.dropdown=function(b){return this.each(function(){var c=a(this),d=c.data("bs.dropdown");d||c.data("bs.dropdown",d=new f(this)),"string"==typeof b&&d[b].call(c)})},a.fn.dropdown.Constructor=f,a.fn.dropdown.noConflict=function(){return a.fn.dropdown=g,this},a(document).on("click.bs.dropdown.data-api",b).on("click.bs.dropdown.data-api",".dropdown form",function(a){a.stopPropagation()}).on("click.bs.dropdown.data-api",e,f.prototype.toggle).on("keydown.bs.dropdown.data-api",e+", [role=menu], [role=listbox]",f.prototype.keydown)}(jQuery),+function(a){var b=function(b,c){this.options=c,this.$element=a(b),this.$backdrop=this.isShown=null,this.options.remote&&this.$element.find(".modal-content").load(this.options.remote,a.proxy(function(){this.$element.trigger("loaded.bs.modal")},this))};b.DEFAULTS={backdrop:!0,keyboard:!0,show:!0},b.prototype.toggle=function(a){return this[this.isShown?"hide":"show"](a)},b.prototype.show=function(b){var c=this,d=a.Event("show.bs.modal",{relatedTarget:b});this.$element.trigger(d),this.isShown||d.isDefaultPrevented()||(this.isShown=!0,this.escape(),this.$element.on("click.dismiss.bs.modal",'[data-dismiss="modal"]',a.proxy(this.hide,this)),this.backdrop(function(){var d=a.support.transition&&c.$element.hasClass("fade");c.$element.parent().length||c.$element.appendTo(document.body),c.$element.show().scrollTop(0),d&&c.$element[0].offsetWidth,c.$element.addClass("in").attr("aria-hidden",!1),c.enforceFocus();var e=a.Event("shown.bs.modal",{relatedTarget:b});d?c.$element.find(".modal-dialog").one(a.support.transition.end,function(){c.$element.focus().trigger(e)}).emulateTransitionEnd(300):c.$element.focus().trigger(e)}))},b.prototype.hide=function(b){b&&b.preventDefault(),b=a.Event("hide.bs.modal"),this.$element.trigger(b),this.isShown&&!b.isDefaultPrevented()&&(this.isShown=!1,this.escape(),a(document).off("focusin.bs.modal"),this.$element.removeClass("in").attr("aria-hidden",!0).off("click.dismiss.bs.modal"),a.support.transition&&this.$element.hasClass("fade")?this.$element.one(a.support.transition.end,a.proxy(this.hideModal,this)).emulateTransitionEnd(300):this.hideModal())},b.prototype.enforceFocus=function(){a(document).off("focusin.bs.modal").on("focusin.bs.modal",a.proxy(function(a){this.$element[0]===a.target||this.$element.has(a.target).length||this.$element.focus()},this))},b.prototype.escape=function(){this.isShown&&this.options.keyboard?this.$element.on("keyup.dismiss.bs.modal",a.proxy(function(a){27==a.which&&this.hide()},this)):this.isShown||this.$element.off("keyup.dismiss.bs.modal")},b.prototype.hideModal=function(){var a=this;this.$element.hide(),this.backdrop(function(){a.removeBackdrop(),a.$element.trigger("hidden.bs.modal")})},b.prototype.removeBackdrop=function(){this.$backdrop&&this.$backdrop.remove(),this.$backdrop=null},b.prototype.backdrop=function(b){var c=this.$element.hasClass("fade")?"fade":"";if(this.isShown&&this.options.backdrop){var d=a.support.transition&&c;if(this.$backdrop=a('<div class="modal-backdrop '+c+'" />').appendTo(document.body),this.$element.on("click.dismiss.bs.modal",a.proxy(function(a){a.target===a.currentTarget&&("static"==this.options.backdrop?this.$element[0].focus.call(this.$element[0]):this.hide.call(this))},this)),d&&this.$backdrop[0].offsetWidth,this.$backdrop.addClass("in"),!b)return;d?this.$backdrop.one(a.support.transition.end,b).emulateTransitionEnd(150):b()}else!this.isShown&&this.$backdrop?(this.$backdrop.removeClass("in"),a.support.transition&&this.$element.hasClass("fade")?this.$backdrop.one(a.support.transition.end,b).emulateTransitionEnd(150):b()):b&&b()};var c=a.fn.modal;a.fn.modal=function(c,d){return this.each(function(){var e=a(this),f=e.data("bs.modal"),g=a.extend({},b.DEFAULTS,e.data(),"object"==typeof c&&c);f||e.data("bs.modal",f=new b(this,g)),"string"==typeof c?f[c](d):g.show&&f.show(d)})},a.fn.modal.Constructor=b,a.fn.modal.noConflict=function(){return a.fn.modal=c,this},a(document).on("click.bs.modal.data-api",'[data-toggle="modal"]',function(b){var c=a(this),d=c.attr("href"),e=a(c.attr("data-target")||d&&d.replace(/.*(?=#[^\s]+$)/,"")),f=e.data("bs.modal")?"toggle":a.extend({remote:!/#/.test(d)&&d},e.data(),c.data());c.is("a")&&b.preventDefault(),e.modal(f,this).one("hide",function(){c.is(":visible")&&c.focus()})}),a(document).on("show.bs.modal",".modal",function(){a(document.body).addClass("modal-open")}).on("hidden.bs.modal",".modal",function(){a(document.body).removeClass("modal-open")})}(jQuery),+function(a){var b=function(a,b){this.type=this.options=this.enabled=this.timeout=this.hoverState=this.$element=null,this.init("tooltip",a,b)};b.DEFAULTS={animation:!0,placement:"top",selector:!1,template:'<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',trigger:"hover focus",title:"",delay:0,html:!1,container:!1},b.prototype.init=function(b,c,d){this.enabled=!0,this.type=b,this.$element=a(c),this.options=this.getOptions(d);for(var e=this.options.trigger.split(" "),f=e.length;f--;){var g=e[f];if("click"==g)this.$element.on("click."+this.type,this.options.selector,a.proxy(this.toggle,this));else if("manual"!=g){var h="hover"==g?"mouseenter":"focusin",i="hover"==g?"mouseleave":"focusout";this.$element.on(h+"."+this.type,this.options.selector,a.proxy(this.enter,this)),this.$element.on(i+"."+this.type,this.options.selector,a.proxy(this.leave,this))}}this.options.selector?this._options=a.extend({},this.options,{trigger:"manual",selector:""}):this.fixTitle()},b.prototype.getDefaults=function(){return b.DEFAULTS},b.prototype.getOptions=function(b){return b=a.extend({},this.getDefaults(),this.$element.data(),b),b.delay&&"number"==typeof b.delay&&(b.delay={show:b.delay,hide:b.delay}),b},b.prototype.getDelegateOptions=function(){var b={},c=this.getDefaults();return this._options&&a.each(this._options,function(a,d){c[a]!=d&&(b[a]=d)}),b},b.prototype.enter=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget)[this.type](this.getDelegateOptions()).data("bs."+this.type);return clearTimeout(c.timeout),c.hoverState="in",c.options.delay&&c.options.delay.show?void(c.timeout=setTimeout(function(){"in"==c.hoverState&&c.show()},c.options.delay.show)):c.show()},b.prototype.leave=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget)[this.type](this.getDelegateOptions()).data("bs."+this.type);return clearTimeout(c.timeout),c.hoverState="out",c.options.delay&&c.options.delay.hide?void(c.timeout=setTimeout(function(){"out"==c.hoverState&&c.hide()},c.options.delay.hide)):c.hide()},b.prototype.show=function(){var b=a.Event("show.bs."+this.type);if(this.hasContent()&&this.enabled){if(this.$element.trigger(b),b.isDefaultPrevented())return;var c=this,d=this.tip();this.setContent(),this.options.animation&&d.addClass("fade");var e="function"==typeof this.options.placement?this.options.placement.call(this,d[0],this.$element[0]):this.options.placement,f=/\s?auto?\s?/i,g=f.test(e);g&&(e=e.replace(f,"")||"top"),d.detach().css({top:0,left:0,display:"block"}).addClass(e),this.options.container?d.appendTo(this.options.container):d.insertAfter(this.$element);var h=this.getPosition(),i=d[0].offsetWidth,j=d[0].offsetHeight;if(g){var k=this.$element.parent(),l=e,m=document.documentElement.scrollTop||document.body.scrollTop,n="body"==this.options.container?window.innerWidth:k.outerWidth(),o="body"==this.options.container?window.innerHeight:k.outerHeight(),p="body"==this.options.container?0:k.offset().left;e="bottom"==e&&h.top+h.height+j-m>o?"top":"top"==e&&h.top-m-j<0?"bottom":"right"==e&&h.right+i>n?"left":"left"==e&&h.left-i<p?"right":e,d.removeClass(l).addClass(e)}var q=this.getCalculatedOffset(e,h,i,j);this.applyPlacement(q,e),this.hoverState=null;var r=function(){c.$element.trigger("shown.bs."+c.type)};a.support.transition&&this.$tip.hasClass("fade")?d.one(a.support.transition.end,r).emulateTransitionEnd(150):r()}},b.prototype.applyPlacement=function(b,c){var d,e=this.tip(),f=e[0].offsetWidth,g=e[0].offsetHeight,h=parseInt(e.css("margin-top"),10),i=parseInt(e.css("margin-left"),10);isNaN(h)&&(h=0),isNaN(i)&&(i=0),b.top=b.top+h,b.left=b.left+i,a.offset.setOffset(e[0],a.extend({using:function(a){e.css({top:Math.round(a.top),left:Math.round(a.left)})}},b),0),e.addClass("in");var j=e[0].offsetWidth,k=e[0].offsetHeight;if("top"==c&&k!=g&&(d=!0,b.top=b.top+g-k),/bottom|top/.test(c)){var l=0;b.left<0&&(l=-2*b.left,b.left=0,e.offset(b),j=e[0].offsetWidth,k=e[0].offsetHeight),this.replaceArrow(l-f+j,j,"left")}else this.replaceArrow(k-g,k,"top");d&&e.offset(b)},b.prototype.replaceArrow=function(a,b,c){this.arrow().css(c,a?50*(1-a/b)+"%":"")},b.prototype.setContent=function(){var a=this.tip(),b=this.getTitle();a.find(".tooltip-inner")[this.options.html?"html":"text"](b),a.removeClass("fade in top bottom left right")},b.prototype.hide=function(){function b(){"in"!=c.hoverState&&d.detach(),c.$element.trigger("hidden.bs."+c.type)}var c=this,d=this.tip(),e=a.Event("hide.bs."+this.type);return this.$element.trigger(e),e.isDefaultPrevented()?void 0:(d.removeClass("in"),a.support.transition&&this.$tip.hasClass("fade")?d.one(a.support.transition.end,b).emulateTransitionEnd(150):b(),this.hoverState=null,this)},b.prototype.fixTitle=function(){var a=this.$element;(a.attr("title")||"string"!=typeof a.attr("data-original-title"))&&a.attr("data-original-title",a.attr("title")||"").attr("title","")},b.prototype.hasContent=function(){return this.getTitle()},b.prototype.getPosition=function(){var b=this.$element[0];return a.extend({},"function"==typeof b.getBoundingClientRect?b.getBoundingClientRect():{width:b.offsetWidth,height:b.offsetHeight},this.$element.offset())},b.prototype.getCalculatedOffset=function(a,b,c,d){return"bottom"==a?{top:b.top+b.height,left:b.left+b.width/2-c/2}:"top"==a?{top:b.top-d,left:b.left+b.width/2-c/2}:"left"==a?{top:b.top+b.height/2-d/2,left:b.left-c}:{top:b.top+b.height/2-d/2,left:b.left+b.width}},b.prototype.getTitle=function(){var a,b=this.$element,c=this.options;return a=b.attr("data-original-title")||("function"==typeof c.title?c.title.call(b[0]):c.title)},b.prototype.tip=function(){return this.$tip=this.$tip||a(this.options.template)},b.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".tooltip-arrow")},b.prototype.validate=function(){this.$element[0].parentNode||(this.hide(),this.$element=null,this.options=null)},b.prototype.enable=function(){this.enabled=!0},b.prototype.disable=function(){this.enabled=!1},b.prototype.toggleEnabled=function(){this.enabled=!this.enabled},b.prototype.toggle=function(b){var c=b?a(b.currentTarget)[this.type](this.getDelegateOptions()).data("bs."+this.type):this;c.tip().hasClass("in")?c.leave(c):c.enter(c)},b.prototype.destroy=function(){clearTimeout(this.timeout),this.hide().$element.off("."+this.type).removeData("bs."+this.type)};var c=a.fn.tooltip;a.fn.tooltip=function(c){return this.each(function(){var d=a(this),e=d.data("bs.tooltip"),f="object"==typeof c&&c;(e||"destroy"!=c)&&(e||d.data("bs.tooltip",e=new b(this,f)),"string"==typeof c&&e[c]())})},a.fn.tooltip.Constructor=b,a.fn.tooltip.noConflict=function(){return a.fn.tooltip=c,this}}(jQuery),+function(a){var b=function(a,b){this.init("popover",a,b)};if(!a.fn.tooltip)throw new Error("Popover requires tooltip.js");b.DEFAULTS=a.extend({},a.fn.tooltip.Constructor.DEFAULTS,{placement:"right",trigger:"click",content:"",template:'<div class="popover"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'}),b.prototype=a.extend({},a.fn.tooltip.Constructor.prototype),b.prototype.constructor=b,b.prototype.getDefaults=function(){return b.DEFAULTS},b.prototype.setContent=function(){var a=this.tip(),b=this.getTitle(),c=this.getContent();a.find(".popover-title")[this.options.html?"html":"text"](b),a.find(".popover-content")[this.options.html?"string"==typeof c?"html":"append":"text"](c),a.removeClass("fade top bottom left right in"),a.find(".popover-title").html()||a.find(".popover-title").hide()},b.prototype.hasContent=function(){return this.getTitle()||this.getContent()},b.prototype.getContent=function(){var a=this.$element,b=this.options;return a.attr("data-content")||("function"==typeof b.content?b.content.call(a[0]):b.content)},b.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".arrow")},b.prototype.tip=function(){return this.$tip||(this.$tip=a(this.options.template)),this.$tip};var c=a.fn.popover;a.fn.popover=function(c){return this.each(function(){var d=a(this),e=d.data("bs.popover"),f="object"==typeof c&&c;(e||"destroy"!=c)&&(e||d.data("bs.popover",e=new b(this,f)),"string"==typeof c&&e[c]())})},a.fn.popover.Constructor=b,a.fn.popover.noConflict=function(){return a.fn.popover=c,this}}(jQuery),+function(a){function b(c,d){var e,f=a.proxy(this.process,this);this.$element=a(a(c).is("body")?window:c),this.$body=a("body"),this.$scrollElement=this.$element.on("scroll.bs.scroll-spy.data-api",f),this.options=a.extend({},b.DEFAULTS,d),this.selector=(this.options.target||(e=a(c).attr("href"))&&e.replace(/.*(?=#[^\s]+$)/,"")||"")+" .nav li > a",this.offsets=a([]),this.targets=a([]),this.activeTarget=null,this.refresh(),this.process()}b.DEFAULTS={offset:10},b.prototype.refresh=function(){var b=this.$element[0]==window?"offset":"position";this.offsets=a([]),this.targets=a([]);{var c=this;this.$body.find(this.selector).map(function(){var d=a(this),e=d.data("target")||d.attr("href"),f=/^#./.test(e)&&a(e);return f&&f.length&&f.is(":visible")&&[[f[b]().top+(!a.isWindow(c.$scrollElement.get(0))&&c.$scrollElement.scrollTop()),e]]||null}).sort(function(a,b){return a[0]-b[0]}).each(function(){c.offsets.push(this[0]),c.targets.push(this[1])})}},b.prototype.process=function(){var a,b=this.$scrollElement.scrollTop()+this.options.offset,c=this.$scrollElement[0].scrollHeight||this.$body[0].scrollHeight,d=c-this.$scrollElement.height(),e=this.offsets,f=this.targets,g=this.activeTarget;if(b>=d)return g!=(a=f.last()[0])&&this.activate(a);if(g&&b<=e[0])return g!=(a=f[0])&&this.activate(a);for(a=e.length;a--;)g!=f[a]&&b>=e[a]&&(!e[a+1]||b<=e[a+1])&&this.activate(f[a])},b.prototype.activate=function(b){this.activeTarget=b,a(this.selector).parentsUntil(this.options.target,".active").removeClass("active");var c=this.selector+'[data-target="'+b+'"],'+this.selector+'[href="'+b+'"]',d=a(c).parents("li").addClass("active");d.parent(".dropdown-menu").length&&(d=d.closest("li.dropdown").addClass("active")),d.trigger("activate.bs.scrollspy")};var c=a.fn.scrollspy;a.fn.scrollspy=function(c){return this.each(function(){var d=a(this),e=d.data("bs.scrollspy"),f="object"==typeof c&&c;e||d.data("bs.scrollspy",e=new b(this,f)),"string"==typeof c&&e[c]()})},a.fn.scrollspy.Constructor=b,a.fn.scrollspy.noConflict=function(){return a.fn.scrollspy=c,this},a(window).on("load",function(){a('[data-spy="scroll"]').each(function(){var b=a(this);b.scrollspy(b.data())})})}(jQuery),+function(a){var b=function(b){this.element=a(b)};b.prototype.show=function(){var b=this.element,c=b.closest("ul:not(.dropdown-menu)"),d=b.data("target");if(d||(d=b.attr("href"),d=d&&d.replace(/.*(?=#[^\s]*$)/,"")),!b.parent("li").hasClass("active")){var e=c.find(".active:last a")[0],f=a.Event("show.bs.tab",{relatedTarget:e});if(b.trigger(f),!f.isDefaultPrevented()){var g=a(d);this.activate(b.parent("li"),c),this.activate(g,g.parent(),function(){b.trigger({type:"shown.bs.tab",relatedTarget:e})})}}},b.prototype.activate=function(b,c,d){function e(){f.removeClass("active").find("> .dropdown-menu > .active").removeClass("active"),b.addClass("active"),g?(b[0].offsetWidth,b.addClass("in")):b.removeClass("fade"),b.parent(".dropdown-menu")&&b.closest("li.dropdown").addClass("active"),d&&d()}var f=c.find("> .active"),g=d&&a.support.transition&&f.hasClass("fade");g?f.one(a.support.transition.end,e).emulateTransitionEnd(150):e(),f.removeClass("in")};var c=a.fn.tab;a.fn.tab=function(c){return this.each(function(){var d=a(this),e=d.data("bs.tab");e||d.data("bs.tab",e=new b(this)),"string"==typeof c&&e[c]()})},a.fn.tab.Constructor=b,a.fn.tab.noConflict=function(){return a.fn.tab=c,this},a(document).on("click.bs.tab.data-api",'[data-toggle="tab"], [data-toggle="pill"]',function(b){b.preventDefault(),a(this).tab("show")})}(jQuery),+function(a){var b=function(c,d){this.options=a.extend({},b.DEFAULTS,d),this.$window=a(window).on("scroll.bs.affix.data-api",a.proxy(this.checkPosition,this)).on("click.bs.affix.data-api",a.proxy(this.checkPositionWithEventLoop,this)),this.$element=a(c),this.affixed=this.unpin=this.pinnedOffset=null,this.checkPosition()};b.RESET="affix affix-top affix-bottom",b.DEFAULTS={offset:0},b.prototype.getPinnedOffset=function(){if(this.pinnedOffset)return this.pinnedOffset;this.$element.removeClass(b.RESET).addClass("affix");var a=this.$window.scrollTop(),c=this.$element.offset();return this.pinnedOffset=c.top-a},b.prototype.checkPositionWithEventLoop=function(){setTimeout(a.proxy(this.checkPosition,this),1)},b.prototype.checkPosition=function(){if(this.$element.is(":visible")){var c=a(document).height(),d=this.$window.scrollTop(),e=this.$element.offset(),f=this.options.offset,g=f.top,h=f.bottom;"top"==this.affixed&&(e.top+=d),"object"!=typeof f&&(h=g=f),"function"==typeof g&&(g=f.top(this.$element)),"function"==typeof h&&(h=f.bottom(this.$element));var i=null!=this.unpin&&d+this.unpin<=e.top?!1:null!=h&&e.top+this.$element.height()>=c-h?"bottom":null!=g&&g>=d?"top":!1;if(this.affixed!==i){this.unpin&&this.$element.css("top","");var j="affix"+(i?"-"+i:""),k=a.Event(j+".bs.affix");this.$element.trigger(k),k.isDefaultPrevented()||(this.affixed=i,this.unpin="bottom"==i?this.getPinnedOffset():null,this.$element.removeClass(b.RESET).addClass(j).trigger(a.Event(j.replace("affix","affixed"))),"bottom"==i&&this.$element.offset({top:c-h-this.$element.height()}))}}};var c=a.fn.affix;a.fn.affix=function(c){return this.each(function(){var d=a(this),e=d.data("bs.affix"),f="object"==typeof c&&c;e||d.data("bs.affix",e=new b(this,f)),"string"==typeof c&&e[c]()})},a.fn.affix.Constructor=b,a.fn.affix.noConflict=function(){return a.fn.affix=c,this},a(window).on("load",function(){a('[data-spy="affix"]').each(function(){var b=a(this),c=b.data();c.offset=c.offset||{},c.offsetBottom&&(c.offset.bottom=c.offsetBottom),c.offsetTop&&(c.offset.top=c.offsetTop),b.affix(c)})})}(jQuery);
////For performance tests please see: http://jsperf.com/js-inheritance-performance/34 + http://jsperf.com/js-inheritance-performance/35 + http://jsperf.com/js-inheritance-performance/36

(function selfCall() {
	var isNode = typeof global != "undefined";
	if (!String.prototype.format) {
		var regexes = {};
		String.prototype.format = function format(parameters) {
			/// <summary>Equivalent to C# String.Format function</summary>
			/// <param name="parameters" type="Object" parameterArray="true">Provide the matching arguments for the format i.e {0}, {1} etc.</param>

			for (var formatMessage = this, args = arguments, i = args.length; --i >= 0;)
				formatMessage = formatMessage.replace(regexes[i] || (regexes[i] = RegExp("\\{" + (i) + "\\}", "gm")), args[i]);
			return formatMessage;
		};
		if (!String.format) {
			String.format = function format(formatMessage, params) {
				/// <summary>Equivalent to C# String.Format function</summary>
				/// <param name="formatMessage" type="string">The message to be formatted. It should contain {0}, {1} etc. for all the given params</param>
				/// <param name="params" type="Object" parameterArray="true">Provide the matching arguments for the format i.e {0}, {1} etc.</param>
				for (var args = arguments, i = args.length; --i;)
					formatMessage = formatMessage.replace(regexes[i - 1] || (regexes[i - 1] = RegExp("\\{" + (i - 1) + "\\}", "gm")), args[i]);
				return formatMessage;
			};
		}
	}
	///#DEBUG
		///#ENDDEBUG

	var Function_prototype = Function.prototype;
	var Array_prototype = Array.prototype;
	var Array_prototype_forEach = Array_prototype.forEach;
	var Object_defineProperty = Object.defineProperty;
	var Object_defineProperties = typeof Object.defineProperties === "function"
	var supportsProto = {};

	supportsProto = supportsProto.__proto__ === Object.prototype;
	if (supportsProto) {
		try {
			supportsProto = {};
			supportsProto.__proto__ = { Object: 1 };
			supportsProto = supportsProto.Object === 1;//setting __proto__ in firefox is terribly slow!
		} catch (ex) { supportsProto = false; }
	}
	/* IE8 and older hack! */
	if (typeof Object.getPrototypeOf !== "function")
		Object.getPrototypeOf = supportsProto
			? function get__proto__(object) {
				return object.__proto__;
			}
			: function getConstructorHack(object) {
				// May break if the constructor has been tampered with
				return object == null || !object.constructor || object === Object.prototype ? null :
					(object.constructor.prototype === object ?
					Object.prototype
					: object.constructor.prototype);
			};
	function __() { };
	//for ancient browsers - polyfill Array.prototype.forEach
	if (!Array_prototype_forEach) {
		Array_prototype.forEach = Array_prototype_forEach = function forEach(fn, scope) {
			for (var i = 0, len = this.length; i < len; ++i) {
				fn.call(scope || this, this[i], i, this);
			}
		}
	}

	Function_prototype.fastClass = function fastClass(creator, mixins) {
		/// <signature>
		/// <summary>Inherits the function's prototype to a new function named constructor returned by the creator parameter
		///<br/><br/>
		/// var Square = Figure.fastClass(function(base, baseCtor) { <br/>
		/// ___ this.constructor = function(name) { //the cosntructor can be optional <br/>
		/// ______ baseCtor.call(this, name); //call the baseCtor <br/>
		/// ___ };<br/>
		/// ___ this.draw = function() {  <br/>
		/// ______ return base.call(this, "square"); //call the base class prototype's method<br/>
		/// ___ };<br/>
		/// }); // you can specify any mixins here<br/>
		///</summary>
		/// <param name="creator" type="Function">function(base, baseCtor) { this.constructor = function() {..}; this.method1 = function() {...}... }<br/>where base is BaseClass.prototype and baseCtor is BaseClass - aka the function you are calling .fastClass on</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the derrived function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>

		//this == constructor of the base "Class"
		var baseClass = this;
		var base = this.prototype;
		creator = creator || function fastClassCreator() { this.constructor = function fastClassCtor() { return baseClass.apply(this, arguments) || this; } };
		creator.prototype = base;

		//creating the derrived class' prototype
		var derrivedProrotype = new creator(base, this);
		var Derrived;
		//did you forget or not intend to add a constructor? We'll add one for you
		if (!derrivedProrotype.hasOwnProperty("constructor"))
			derrivedProrotype.constructor = function fastClassDefaultConstructor() { return baseClass.apply(this, arguments) || this; }
		Derrived = derrivedProrotype.constructor;
		//setting the derrivedPrototype to constructor's prototype
		Derrived.prototype = derrivedProrotype;

		///#DEBUG
				///#ENDDEBUG 


		creator = null;//set the first parameter to null as we have already 'shared' the base prototype into derrivedPrototype in the creator function by setting creator.prototype = base on above
		arguments.length > 1 && Function_prototype.define.apply(Derrived, arguments);
		Derrived.constructor = Derrived;
		//returning the constructor
		return Derrived; 
	};

	Function_prototype.inheritWith = !supportsProto ? function inheritWith(creator, mixins) {
		/// <signature>
		/// <summary>Inherits the function's prototype to a new function named constructor returned by the creator parameter
		///<br/><br/>
		/// var Square = Figure.inheritWith(function(base, baseCtor) { <br/>
		/// ___ return { <br/>
		/// ______ constructor: function(name) { //the cosntructor can be optional <br/>
		/// _________ baseCtor.call(this, name); //explicitelly call the base class by name <br/>
		/// ______ },<br/>
		/// ______ draw: function() {  <br/>
		/// _________ return base.call(this, "square"); //explicitely call the base class prototype's  method by name <br/>
		/// ______ },<br/>
		/// ___ };<br/>
		/// }); // you can specify any mixins here<br/>
		///</summary>
		/// <param name="creator" type="Function">function(base, baseCtor) { return { constructor: function() {..}...} }<br/>where base is BaseClass.prototype and baseCtor is BaseClass - aka the function you are calling .inheritWith on</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the derrived function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		/// <signature>
		/// <summary>Inherits the function's prototype to a new function named constructor passed into the object as parameter
		///<br/><br/>
		/// var Square = Figure.inheritWith({ <br/>
		/// ___ constructor: function(name) { //the cosntructor can be optional <br/>
		/// ______ Figure.call(this, name); //call the baseCtor <br/>
		/// ___ },<br/>
		/// ___ draw: function() {  <br/>
		/// ______ return Figure.prototype.call(this, "square"); //call the base class prototype's method<br/>
		/// ___ },<br/>
		/// }); // you can specify any mixins here<br/>
		///</summary>
		/// <param name="creator" type="Object">An object containing members for the new function's prototype</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the derrived function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		var baseCtor = this;
		var creatorResult = (typeof creator === "function" ? creator.call(this, this.prototype, this) : creator) || {};
		var Derrived = creatorResult.hasOwnProperty('constructor') ? creatorResult.constructor : function inheritWithConstructor() {
			return baseCtor.apply(this, arguments) || this;
		}; //automatic constructor if ommited
		///#DEBUG
				///#ENDDEBUG 
		var derrivedPrototype;
		__.prototype = this.prototype;
		Derrived.prototype = derrivedPrototype = new __;


		creator = creatorResult;//change the first parameter with the creatorResult
		Function_prototype.define.apply(Derrived, arguments);
		Derrived.constructor = Derrived;

		return Derrived;
	} :// when browser supports __proto__ setting it is way faster than iterating the object
	function inheritWithProto(creator, mixins) {
		/// <signature>
		/// <summary>Inherits the function's prototype to a new function named constructor returned by the creator parameter
		///<br/><br/>
		/// var Square = Figure.inheritWith(function(base, baseCtor) { <br/>
		/// ___ return { <br/>
		/// ______ constructor: function(name) { //the cosntructor can be optional <br/>
		/// _________ baseCtor.call(this, name); //explicitelly call the base class by name <br/>
		/// ______ },<br/>
		/// ______ draw: function() {  <br/>
		/// _________ return base.call(this, "square"); //explicitely call the base class prototype's  method by name <br/>
		/// ______ },<br/>
		/// ___ };<br/>
		/// }); // you can specify any mixins here<br/>
		///</summary>
		/// <param name="creator" type="Function">function(base, baseCtor) { return { constructor: function() {..}...} }<br/>where base is BaseClass.prototype and baseCtor is BaseClass - aka the function you are calling .inheritWith on</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the derrived function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		/// <signature>
		/// <summary>Inherits the function's prototype to a new function named constructor passed into the object as parameter
		///<br/><br/>
		/// var Square = Figure.inheritWith({ <br/>
		/// ___ constructor: function(name) { //the cosntructor can be optional <br/>
		/// ______ Figure.call(this, name); //call the baseCtor <br/>
		/// ___ },<br/>
		/// ___ draw: function() {  <br/>
		/// ______ return Figure.prototype.call(this, "square"); //call the base class prototype's method<br/>
		/// ___ },<br/>
		/// }); // you can specify any mixins here<br/>
		///</summary>
		/// <param name="creator" type="Object">An object containing members for the new function's prototype</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the derrived function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		var baseCtor = this;
		var creatorResult = (typeof creator === "function" ? creator.call(this, this.prototype, this) : creator) || {};
		var Derrived = creatorResult.hasOwnProperty('constructor') ? creatorResult.constructor : function inheritWithProtoDefaultConstructor() {
			return baseCtor.apply(this, arguments) || this;
		}; //automatic constructor if ommited
		///#DEBUG
				///#ENDDEBUG 
		Derrived.prototype = creatorResult;
		creatorResult.__proto__ = this.prototype;
		creator = null;//set the first parameter to null as we have already 'shared' the base prototype into creatorResult by using __proto__
		arguments.length > 1 && Function_prototype.define.apply(Derrived, arguments);
		Derrived.constructor = Derrived;
		return Derrived;
	};
	Function_prototype.define = function define(prototype, mixins) {
		/// <summary>Define members on the prototype of the given function with the custom methods and fields specified in the prototype parameter.</summary>
		/// <param name="prototype" type="Function || Plain Object">{} or function(prototype, ctor) {}<br/>A custom object with the methods or properties to be added on Extendee.prototype<br/><br/>
		/// You can sepcify enumerable: false, which will define the members as non-enumerable making use of Object.defineProperty(this, key, {enumerable: false, value: copyPropertiesFrom[key]})
		///</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to this function's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		var constructor = this;
		var extendeePrototype = this.prototype;
		var creatorResult = prototype;
		var key, enumerable;
		if (prototype) {
			if (typeof prototype === "function")
				prototype = prototype.call(extendeePrototype, this.prototype, this);
			if (prototype.enumerable === false) {
				for (key in prototype)
					if (key !== 'enumerable')
						Object.defineProperty(extendeePrototype, key, { enumerable: false, value: prototype[key] });
			}
			else for (key in prototype)
				extendeePrototype[key] = prototype[key];
		}
		prototype = null;
		//intellisense.logMessage("defining....");
		(arguments.length > 2 || mixins) && (extendeePrototype.hasOwnProperty("__mixins__") || (Object_defineProperties ? (Object_defineProperty(extendeePrototype, "__mixins__", { enumerable: false, value: [], writeable: false }).__mixins__.__hidden = true) : extendeePrototype.__mixins__ = [])) && Array_prototype_forEach.call(arguments, function forEachMixin(mixin, index, mixinValue, isFunction) {
			isFunction = typeof mixin === 'function';
			if (isFunction) {
				__.prototype = mixin.prototype;
				mixinValue = new mixin(extendeePrototype, constructor);
			}
			else mixinValue = mixin;
			if (mixinValue) {
				//store the functions in the __mixins__ member on the prototype so they will be called on Function.initMixins(instance) function
				isFunction && extendeePrototype.__mixins__.push(mixin);
				//copy the prototype members from the mixin.prototype to extendeePrototype so we are only doing this once
				for (var key in mixinValue)
					if (key != "constructor" && key != "prototype") {
						//intellisense.logMessage("injecting " + key + " into " + extendeePrototype.name);
						///#DEBUG
												///#ENDDEBUG 
						extendeePrototype[key] = mixinValue[key];
					}
			}
		});
		///#DEBUG
				///#ENDDEBUG 
		return this;
	}


	Function.define = function Function_define(func, prototype, mixins) {
		/// <signature>
		/// <summary>Extends the given func's prototype with provided members of prototype and ensures calling the mixins in the constructor</summary>
		/// <param name="func" type="Function">Specify the constructor function you want to define i.e. function() {}</param>
		/// <param name="prototype" type="Plain Object" optional="true">Specify an object that contain the functions or members that should defined on the provided func's prototype</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the returned func's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		/// <signature>
		/// <summary>Extends the given constructor's prototype with provided members of prototype and ensures calling the mixins in the constructor</summary>
		/// <param name="prototype" type="Plain Object">Specify an object that contain the constructor and functions or members that should defined on the provided constructor's prototype</param>
		/// <param name="mixins"  type="Function || Plain Object" optional="true" parameterArray="true">Specify one ore more mixins to be added to the returned func's prototype. <br/>A Mixin is either a function which returns a plain object, or a plan object in itself. It contains method or properties to be added to this function's prototype</param>
		/// </signature>
		var result;
		var constructor = func || function defineDefaultConstructor() { }; //automatic constructor if ommited
		var applyDefine = arguments.length > 1;
		if (typeof func !== "function") {
			constructor = func.hasOwnProperty("constructor") ? func.constructor : function constructorDefaultObjConstructor() { };

			constructor.prototype = func;
			///#DEBUG
						///#ENDDEBUG 


			applyDefine = true;
		}
		else {
			func = prototype;
			prototype = null;
		}
		applyDefine && Function_prototype.define.apply(constructor, arguments);

		result = function defineInitMixinsConstructor() {
			// automatically call initMixins and then the first constructor
			Function.initMixins(this);
			return constructor.apply(this, arguments) || this;
		}
		//we are sharing constructor's prototype
		result.prototype = constructor.prototype;
		//forward the VS2012 intellisense to the given constructor function
		///#DEBUG
				///#ENDDEBUG 
		result.constructor = result.prototype.constructor = constructor.constructor = constructor.prototype.constructor = result;
		return result;
	};

	Function_prototype.defineStatic = function (copyPropertiesFrom) {
		/// <summary>Copies all the members of the given object, including those on its prototype if any, to this function (and not on its prototype)<br/>For extending this functions' prototype use .define()
		/// <param name="copyPropertiesFrom" type="Object">The object to copy the properties from<br/><br/>
		/// You can sepcify enumerable: false, which will define the members as non-enumerable making use of Object.defineProperty(this, key, {enumerable: false, value: copyPropertiesFrom[key]})</summary>
		/// </param>
		var key;
		if (typeof copyPropertiesFrom == "object")
			if (copyPropertiesFrom.enumerable === false) {
				for (key in copyPropertiesFrom)
					if (key !== 'enumerable')
					Object.defineProperty(this, key, { enumerable: false, configurable: true, value: copyPropertiesFrom[key] });
			}
			for (key in copyPropertiesFrom) {
				this[key] = copyPropertiesFrom[key];
			}
		return this;
	}
	function defaultAbstractMethod() {
		///#DEBUG
				///#ENDDEBUG 
	}
	defaultAbstractMethod.defineStatic({ abstract: true });
	Function.abstract = function (message, func) {
		/// <summary>Returns an abstract function that asserts the given message. Optionally you can add some code to happen before assertion too</summary>
		/// <param name="message" type="String || Function">The message to be thrown when the newly method will be called. <br/>Defaults to: Not implemented</param>
		/// <param name="func" type="Function" optional="true">Specify a custom function to be called before the assertion is thrown.</param>
		var result = message || func ? (function () {
			if (typeof message === "function")
				message.apply(this, arguments);
			if (typeof func === "function")
				func.apply(this, arguments);
			///#DEBUG
						///#ENDDEBUG 

		}).defineStatic({ abstract: true }) : defaultAbstractMethod;

		///#DEBUG
				///#ENDDEBUG 

		return result;
	}

	Function.initMixins = supportsProto ? function initMixins(objectInstance) {
		/// <signature>
		/// <summary>Initializes the mixins on all of the prototypes of the given object instance<br/>This should only be called once per object, usually in the first constructor (the most base class)</summary>
		/// <param name="objectInstance" type="Object">The object instance for which the mixins needs to be initialized</param>
		/// </signature>
		if (objectInstance && !objectInstance.__initMixins__) {
			var p = objectInstance, mixins, length, i, mixin, calledMixins = {};
			objectInstance.__initMixins__ = 1;
			///#DEBUG
						///#ENDDEBUG 
			while (p) {
				p = p.__proto__;
				if (p && p.hasOwnProperty("__mixins__") && (mixins = p.__mixins__) && (length = mixins.length))
					for (i = 0; mixin = mixins[i], i < length; i++) {
						//WAssert(true, window.intellisense && function WAssert() {
						//	//for correct VS2012 intellisense, at the time of mixin declaration we need to execute new mixin() rather than mixin.call(objectInstance, p, p.constructor) otherwise the glyph icons will look like they are defined on mixin / prototype rather than on the mixin itself
						//	if (!(mixin in calledMixins)) {
						//		calledMixins[mixin] = 1;
						//		new mixin(p, p.constructor);
						//	}
						//});
						if (!(mixin in calledMixins)) {
							calledMixins[mixin] = 1;
							mixin.call(objectInstance, p, p.constructor);
						}
					}
			}
			objectInstance.__initMixins__ = undefined;
		}
	}: function initMixinsWithoutProto(objectInstance) {
		/// <signature>
		/// <summary>Initializes the mixins on all of the prototypes of the given object instance<br/>This should only be called once per object, usually in the first constructor (the most base class)</summary>
		/// <param name="objectInstance" type="Object">The object instance for which the mixins needs to be initialized</param>
		/// </signature>
		if (objectInstance && !objectInstance.__initMixins__) {
			var p = objectInstance, mixins, length, i, mixin, calledMixins = {};
			objectInstance.__initMixins__ = 1;
			///#DEBUG
						///#ENDDEBUG 
			while (p) {
				p = Object.getPrototypeOf(p);
				if (p && p.hasOwnProperty("__mixins__") && (mixins = p.__mixins__) && (length = mixins.length))
					for (i = 0; mixin = mixins[i], i < length; i++) {
						//WAssert(true, window.intellisense && function WAssert() {
						//	//for correct VS2012 intellisense, at the time of mixin declaration we need to execute new mixin() rather than mixin.call(objectInstance, p, p.constructor) otherwise the glyph icons will look like they are defined on mixin / prototype rather than on the mixin itself
						//	if (!(mixin in calledMixins)) {
						//		calledMixins[mixin] = 1;
						//		new mixin(p, p.constructor);
						//	}
						//});
						if (!(mixin in calledMixins)) {
							calledMixins[mixin] = 1;
							mixin.call(objectInstance, p, p.constructor);
						}
					}
			}
			objectInstance.__initMixins__ = undefined;
		}
	};;

	if (Object_defineProperties) {
		var o = {
			0: [Function, "initMixins", "define", "abstract"],
			1: [Function_prototype, "fastClass", "inheritWith", "define", "defineStatic"]
		}
		for (var p in o)
			for (var props = o[p], obj = props[0], i = 1, prop; prop = props[i], i < props.length; i++) {
				Object_defineProperty(obj, prop, { enumerable: false, value: obj[prop] });
			}
	}

})();
////Uncomment this for a quick demo & self test
//////////////////OPTION 1: inheritWith////////////////////////
////Using Define: 
////Function.prototype.define(proto) copies the given value from proto to function.prototype i.e. A in this case

//////Aternative for Function.define we can do this:
////var A = function (val) {
////     Function.initMixins(this);// since this is a top function, we need to call initMixins to make sure they will be initialized.
////	this.val = val;
////}.define({
////	method1: function (x, y, z) {
////		this.x = x;
////		this.y = y;
////		this.z = z;
////	}
////});

////To define the top level (first) function there is a sugar (as well as the above alternative)
//var A = Function.define(function(val) {
//     // when we are definin a top function with Function.define we DON'T need to call initMixins because they will be called automatically for us
//	this.val = val;
//}, {
//	method1: function (x, y, z) {
//		this.x = x;
//		this.y = y;
//		this.z = z;
//	}
//});


////Follow derrivations using inheritWith

//var B = A.inheritWith(function (base, baseCtor) {
//	return {
//		constructor: function (val) { baseCtor.call(this, val) },
//		method1: function (y, z) {
//			base.method1.call(this, 'x', 'y', z);
//		}
//	};
//});

//var C = B.inheritWith(function (base, baseCtor) {
//	return {
//		constructor: function (val) { baseCtor.call(this, val) },
//		method1: function (z) {
//			base.method1.call(this, 'y', z);
//		}
//	};
//});

//var D = C.inheritWith(function (base, baseCtor) {
//	return {
//		constructor: function (val) { baseCtor.call(this, val) },
//		method1: function (z) {
//			base.method1.call(this, z);
//		}
//	};
//});


//selfTest();

//////////////////OPTION 2: fastClass////////////////////////
////Using Define:

////Aternative for Function.define we can do this:
//var A = function (val) {
//     Function.initMixins(this);// since this is a top function, we need to call initMixins to make sure they will be initialized.
//	this.val = val;
//}.define({
//	method1: function (x, y, z) {
//		this.x = x;
//		this.y = y;
//		this.z = z;
//	}
//});

////To define the top level (first) function there is a sugar (as well as the above alternative)
//var A = Function.define(function A(val) {
//     // when we are definin a top function with Function.define we DON'T need to call initMixins because they will be called automatically for us
//	this.val = val;
//}, {
//	method1: function (x, y, z) {
//		this.x = x;
//		this.y = y;
//		this.z = z;
//	}
//});


////Follow derrivations using fastClass
//var B = A.fastClass(function (base, baseCtor) {
//	this.constructor = function B(val) { baseCtor.call(this, val) };
//	this.method1 = function (y, z) {
//		base.method1.call(this, 'x', y, z);
//	}
//});
//var C = B.fastClass(function (base, baseCtor) {
//	this.constructor = function C(val) { baseCtor.call(this, val) };
//	this.method1 = function (z) {
//		base.method1.call(this, 'y', z);
//	};
//});

//var D = C.fastClass(function (base, baseCtor) {
//	this.constructor = function D(val) { baseCtor.call(this, val) };
//	this.method1 = function (z) {
//		base.method1.call(this, z);
//	};
//});

////selfTest();

//function selfTest() {
//	var a = new A("a");
//	a.method1("x", "y", "z");
//	console.assert(a.x == "x", "a.x should be set to 'x'");
//	console.assert(a.y == "y", "a.y should be set to 'y'");
//	console.assert(a.z == "z", "a.z should be set to 'z'");
//	var b = new B("b");
//	b.method1("y", "z");
//	console.assert(b.x == "x", "b.x should be set to 'x'");
//	console.assert(b.y == "y", "b.y should be set to 'y'");
//	console.assert(b.z == "z", "b.z should be set to 'z'");
//	var c = new C("c");
//	c.method1("z");
//	console.assert(c.x == "x", "c.x should be set to 'x'");
//	console.assert(c.y == "y", "c.y should be set to 'y'");
//	console.assert(c.z == "z", "c.z should be set to 'z'");

//	var d = new D("d");
//	d.method1("w");
//	console.assert(d.x == "x", "d.x should be set to 'x'");
//	console.assert(d.y == "y", "d.y should be set to 'y'");
//	console.assert(d.z == "w", "d.z should be set to 'w'");

//	var expecteds = {
//		"d instanceof A": true,
//		"d instanceof B": true,
//		"d instanceof C": true,
//		"d instanceof D": true,
//		"c instanceof A": true,
//		"c instanceof B": true,
//		"c instanceof C": true,
//		"b instanceof A": true,
//		"b instanceof B": true,
//		"b instanceof C": false,
//		"a instanceof A": true,
//		"a instanceof B": false,
//		"a instanceof C": false,
//"A.prototype.constructor === a.constructor && a.constructor === A.constructor": true,//this should not equal to A itself due to mixins base function
//"B.prototype.constructor === b.constructor && b.constructor === B && B == B.constructor": true,
//"C.prototype.constructor === c.constructor && c.constructor === C && B == B.constructor": true,
//"D.prototype.constructor === d.constructor && d.constructor === D && B == B.constructor": true,
//}
//	for (var expectedKey in expecteds) {
//		var expected = expecteds[expectedKey];
//		var actual = eval(expectedKey);//using eval for quick demo self test purposing -- using eval is not recommended otherwise
//		console.assert(!(expected ^ actual), expectedKey + " expected: " + expected + ", actual: " + actual);
//	}
//}
//console.log("If there are no asserts in the console then all tests have passed! yey :)")

////defining a mixin
//var Point = function Point() {
//	this.point = { x: 1, y: 2 };
//}.define({
//	x: function x(x) {
//		/// <param name="x" optional="true">Specify a value to set the point.x. Don't specify anything will retrieve point.x</param>
//		return arguments.length ? (this.point.x = x) && this || this : this.point.x;
//	},
//	y: function y(y) {
//		/// <param name="y" optional="true">Specify a value to set the point.y. Don't specify anything will retrieve point.y</param>
//		return arguments.length ? (this.point.y = y) && this || this : this.point.y;
//	}
//});

////referencing the mixin:
//var E = D.inheritWith(function (base, baseCtor) {
//	return {
//		//no constructor !! - it will be added automatically for us
//		method1: function (z) {
//			base.method1.call(this, z);
//		}
//	};
//}, Point//specifying zero or more mixins - comma separated
//);

//var e = new E();
//e.x(2);//sets e.point.x to 2
//console.log("mixin Point.x expected to return 2. Actual: ", e.x());//returns 2
;
// Knockout JavaScript library v3.1.0
// (c) Steven Sanderson - http://knockoutjs.com/
// License: MIT (http://www.opensource.org/licenses/mit-license.php)

(function() {(function(p){var A=this||(0,eval)("this"),w=A.document,K=A.navigator,t=A.jQuery,C=A.JSON;(function(p){"function"===typeof require&&"object"===typeof exports&&"object"===typeof module?p(module.exports||exports):"function"===typeof define&&define.amd&&define('vendor/hw/knockout',["exports"],p);p(A.ko={})})(function(z){function G(a,c){return null===a||typeof a in M?a===c:!1}function N(a,c){var d;return function(){d||(d=setTimeout(function(){d=p;a()},c))}}function O(a,c){var d;return function(){clearTimeout(d);d=setTimeout(a,
c)}}function H(b,c,d,e){a.d[b]={init:function(b,h,g,k,l){var n,r;a.ba(function(){var g=a.a.c(h()),k=!d!==!g,s=!r;if(s||c||k!==n)s&&a.ca.fa()&&(r=a.a.lb(a.e.childNodes(b),!0)),k?(s||a.e.U(b,a.a.lb(r)),a.gb(e?e(l,g):l,b)):a.e.da(b),n=k},null,{G:b});return{controlsDescendantBindings:!0}}};a.g.aa[b]=!1;a.e.Q[b]=!0}var a="undefined"!==typeof z?z:{};a.b=function(b,c){for(var d=b.split("."),e=a,f=0;f<d.length-1;f++)e=e[d[f]];e[d[d.length-1]]=c};a.s=function(a,c,d){a[c]=d};a.version="3.1.0";a.b("version",
a.version);a.a=function(){function b(a,b){for(var c in a)a.hasOwnProperty(c)&&b(c,a[c])}function c(a,b){if(b)for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a}function d(a,b){a.__proto__=b;return a}var e={__proto__:[]}instanceof Array,f={},h={};f[K&&/Firefox\/2/i.test(K.userAgent)?"KeyboardEvent":"UIEvents"]=["keyup","keydown","keypress"];f.MouseEvents="click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave".split(" ");b(f,function(a,b){if(b.length)for(var c=0,
d=b.length;c<d;c++)h[b[c]]=a});var g={propertychange:!0},k=w&&function(){for(var a=3,b=w.createElement("div"),c=b.getElementsByTagName("i");b.innerHTML="\x3c!--[if gt IE "+ ++a+"]><i></i><![endif]--\x3e",c[0];);return 4<a?a:p}();return{mb:["authenticity_token",/^__RequestVerificationToken(_.*)?$/],r:function(a,b){for(var c=0,d=a.length;c<d;c++)b(a[c],c)},l:function(a,b){if("function"==typeof Array.prototype.indexOf)return Array.prototype.indexOf.call(a,b);for(var c=0,d=a.length;c<d;c++)if(a[c]===
b)return c;return-1},hb:function(a,b,c){for(var d=0,e=a.length;d<e;d++)if(b.call(c,a[d],d))return a[d];return null},ma:function(b,c){var d=a.a.l(b,c);0<d?b.splice(d,1):0===d&&b.shift()},ib:function(b){b=b||[];for(var c=[],d=0,e=b.length;d<e;d++)0>a.a.l(c,b[d])&&c.push(b[d]);return c},ya:function(a,b){a=a||[];for(var c=[],d=0,e=a.length;d<e;d++)c.push(b(a[d],d));return c},la:function(a,b){a=a||[];for(var c=[],d=0,e=a.length;d<e;d++)b(a[d],d)&&c.push(a[d]);return c},$:function(a,b){if(b instanceof Array)a.push.apply(a,
b);else for(var c=0,d=b.length;c<d;c++)a.push(b[c]);return a},Y:function(b,c,d){var e=a.a.l(a.a.Sa(b),c);0>e?d&&b.push(c):d||b.splice(e,1)},na:e,extend:c,ra:d,sa:e?d:c,A:b,Oa:function(a,b){if(!a)return a;var c={},d;for(d in a)a.hasOwnProperty(d)&&(c[d]=b(a[d],d,a));return c},Fa:function(b){for(;b.firstChild;)a.removeNode(b.firstChild)},ec:function(b){b=a.a.R(b);for(var c=w.createElement("div"),d=0,e=b.length;d<e;d++)c.appendChild(a.M(b[d]));return c},lb:function(b,c){for(var d=0,e=b.length,g=[];d<
e;d++){var k=b[d].cloneNode(!0);g.push(c?a.M(k):k)}return g},U:function(b,c){a.a.Fa(b);if(c)for(var d=0,e=c.length;d<e;d++)b.appendChild(c[d])},Bb:function(b,c){var d=b.nodeType?[b]:b;if(0<d.length){for(var e=d[0],g=e.parentNode,k=0,h=c.length;k<h;k++)g.insertBefore(c[k],e);k=0;for(h=d.length;k<h;k++)a.removeNode(d[k])}},ea:function(a,b){if(a.length){for(b=8===b.nodeType&&b.parentNode||b;a.length&&a[0].parentNode!==b;)a.shift();if(1<a.length){var c=a[0],d=a[a.length-1];for(a.length=0;c!==d;)if(a.push(c),
c=c.nextSibling,!c)return;a.push(d)}}return a},Db:function(a,b){7>k?a.setAttribute("selected",b):a.selected=b},ta:function(a){return null===a||a===p?"":a.trim?a.trim():a.toString().replace(/^[\s\xa0]+|[\s\xa0]+$/g,"")},oc:function(b,c){for(var d=[],e=(b||"").split(c),g=0,k=e.length;g<k;g++){var h=a.a.ta(e[g]);""!==h&&d.push(h)}return d},kc:function(a,b){a=a||"";return b.length>a.length?!1:a.substring(0,b.length)===b},Sb:function(a,b){if(a===b)return!0;if(11===a.nodeType)return!1;if(b.contains)return b.contains(3===
a.nodeType?a.parentNode:a);if(b.compareDocumentPosition)return 16==(b.compareDocumentPosition(a)&16);for(;a&&a!=b;)a=a.parentNode;return!!a},Ea:function(b){return a.a.Sb(b,b.ownerDocument.documentElement)},eb:function(b){return!!a.a.hb(b,a.a.Ea)},B:function(a){return a&&a.tagName&&a.tagName.toLowerCase()},q:function(b,c,d){var e=k&&g[c];if(!e&&t)t(b).bind(c,d);else if(e||"function"!=typeof b.addEventListener)if("undefined"!=typeof b.attachEvent){var h=function(a){d.call(b,a)},f="on"+c;b.attachEvent(f,
h);a.a.u.ja(b,function(){b.detachEvent(f,h)})}else throw Error("Browser doesn't support addEventListener or attachEvent");else b.addEventListener(c,d,!1)},ha:function(b,c){if(!b||!b.nodeType)throw Error("element must be a DOM node when calling triggerEvent");var d;"input"===a.a.B(b)&&b.type&&"click"==c.toLowerCase()?(d=b.type,d="checkbox"==d||"radio"==d):d=!1;if(t&&!d)t(b).trigger(c);else if("function"==typeof w.createEvent)if("function"==typeof b.dispatchEvent)d=w.createEvent(h[c]||"HTMLEvents"),
d.initEvent(c,!0,!0,A,0,0,0,0,0,!1,!1,!1,!1,0,b),b.dispatchEvent(d);else throw Error("The supplied element doesn't support dispatchEvent");else if(d&&b.click)b.click();else if("undefined"!=typeof b.fireEvent)b.fireEvent("on"+c);else throw Error("Browser doesn't support triggering events");},c:function(b){return a.v(b)?b():b},Sa:function(b){return a.v(b)?b.o():b},ua:function(b,c,d){if(c){var e=/\S+/g,g=b.className.match(e)||[];a.a.r(c.match(e),function(b){a.a.Y(g,b,d)});b.className=g.join(" ")}},Xa:function(b,
c){var d=a.a.c(c);if(null===d||d===p)d="";var e=a.e.firstChild(b);!e||3!=e.nodeType||a.e.nextSibling(e)?a.e.U(b,[b.ownerDocument.createTextNode(d)]):e.data=d;a.a.Vb(b)},Cb:function(a,b){a.name=b;if(7>=k)try{a.mergeAttributes(w.createElement("<input name='"+a.name+"'/>"),!1)}catch(c){}},Vb:function(a){9<=k&&(a=1==a.nodeType?a:a.parentNode,a.style&&(a.style.zoom=a.style.zoom))},Tb:function(a){if(k){var b=a.style.width;a.style.width=0;a.style.width=b}},ic:function(b,c){b=a.a.c(b);c=a.a.c(c);for(var d=
[],e=b;e<=c;e++)d.push(e);return d},R:function(a){for(var b=[],c=0,d=a.length;c<d;c++)b.push(a[c]);return b},mc:6===k,nc:7===k,oa:k,ob:function(b,c){for(var d=a.a.R(b.getElementsByTagName("input")).concat(a.a.R(b.getElementsByTagName("textarea"))),e="string"==typeof c?function(a){return a.name===c}:function(a){return c.test(a.name)},g=[],k=d.length-1;0<=k;k--)e(d[k])&&g.push(d[k]);return g},fc:function(b){return"string"==typeof b&&(b=a.a.ta(b))?C&&C.parse?C.parse(b):(new Function("return "+b))():
null},Ya:function(b,c,d){if(!C||!C.stringify)throw Error("Cannot find JSON.stringify(). Some browsers (e.g., IE < 8) don't support it natively, but you can overcome this by adding a script reference to json2.js, downloadable from http://www.json.org/json2.js");return C.stringify(a.a.c(b),c,d)},gc:function(c,d,e){e=e||{};var g=e.params||{},k=e.includeFields||this.mb,h=c;if("object"==typeof c&&"form"===a.a.B(c))for(var h=c.action,f=k.length-1;0<=f;f--)for(var u=a.a.ob(c,k[f]),D=u.length-1;0<=D;D--)g[u[D].name]=
u[D].value;d=a.a.c(d);var y=w.createElement("form");y.style.display="none";y.action=h;y.method="post";for(var p in d)c=w.createElement("input"),c.name=p,c.value=a.a.Ya(a.a.c(d[p])),y.appendChild(c);b(g,function(a,b){var c=w.createElement("input");c.name=a;c.value=b;y.appendChild(c)});w.body.appendChild(y);e.submitter?e.submitter(y):y.submit();setTimeout(function(){y.parentNode.removeChild(y)},0)}}}();a.b("utils",a.a);a.b("utils.arrayForEach",a.a.r);a.b("utils.arrayFirst",a.a.hb);a.b("utils.arrayFilter",
a.a.la);a.b("utils.arrayGetDistinctValues",a.a.ib);a.b("utils.arrayIndexOf",a.a.l);a.b("utils.arrayMap",a.a.ya);a.b("utils.arrayPushAll",a.a.$);a.b("utils.arrayRemoveItem",a.a.ma);a.b("utils.extend",a.a.extend);a.b("utils.fieldsIncludedWithJsonPost",a.a.mb);a.b("utils.getFormFields",a.a.ob);a.b("utils.peekObservable",a.a.Sa);a.b("utils.postJson",a.a.gc);a.b("utils.parseJson",a.a.fc);a.b("utils.registerEventHandler",a.a.q);a.b("utils.stringifyJson",a.a.Ya);a.b("utils.range",a.a.ic);a.b("utils.toggleDomNodeCssClass",
a.a.ua);a.b("utils.triggerEvent",a.a.ha);a.b("utils.unwrapObservable",a.a.c);a.b("utils.objectForEach",a.a.A);a.b("utils.addOrRemoveItem",a.a.Y);a.b("unwrap",a.a.c);Function.prototype.bind||(Function.prototype.bind=function(a){var c=this,d=Array.prototype.slice.call(arguments);a=d.shift();return function(){return c.apply(a,d.concat(Array.prototype.slice.call(arguments)))}});a.a.f=new function(){function a(b,h){var g=b[d];if(!g||"null"===g||!e[g]){if(!h)return p;g=b[d]="ko"+c++;e[g]={}}return e[g]}
var c=0,d="__ko__"+(new Date).getTime(),e={};return{get:function(c,d){var e=a(c,!1);return e===p?p:e[d]},set:function(c,d,e){if(e!==p||a(c,!1)!==p)a(c,!0)[d]=e},clear:function(a){var b=a[d];return b?(delete e[b],a[d]=null,!0):!1},L:function(){return c++ +d}}};a.b("utils.domData",a.a.f);a.b("utils.domData.clear",a.a.f.clear);a.a.u=new function(){function b(b,c){var e=a.a.f.get(b,d);e===p&&c&&(e=[],a.a.f.set(b,d,e));return e}function c(d){var e=b(d,!1);if(e)for(var e=e.slice(0),k=0;k<e.length;k++)e[k](d);
a.a.f.clear(d);a.a.u.cleanExternalData(d);if(f[d.nodeType])for(e=d.firstChild;d=e;)e=d.nextSibling,8===d.nodeType&&c(d)}var d=a.a.f.L(),e={1:!0,8:!0,9:!0},f={1:!0,9:!0};return{ja:function(a,c){if("function"!=typeof c)throw Error("Callback must be a function");b(a,!0).push(c)},Ab:function(c,e){var k=b(c,!1);k&&(a.a.ma(k,e),0==k.length&&a.a.f.set(c,d,p))},M:function(b){if(e[b.nodeType]&&(c(b),f[b.nodeType])){var d=[];a.a.$(d,b.getElementsByTagName("*"));for(var k=0,l=d.length;k<l;k++)c(d[k])}return b},
removeNode:function(b){a.M(b);b.parentNode&&b.parentNode.removeChild(b)},cleanExternalData:function(a){t&&"function"==typeof t.cleanData&&t.cleanData([a])}}};a.M=a.a.u.M;a.removeNode=a.a.u.removeNode;a.b("cleanNode",a.M);a.b("removeNode",a.removeNode);a.b("utils.domNodeDisposal",a.a.u);a.b("utils.domNodeDisposal.addDisposeCallback",a.a.u.ja);a.b("utils.domNodeDisposal.removeDisposeCallback",a.a.u.Ab);(function(){a.a.Qa=function(b){var c;if(t)if(t.parseHTML)c=t.parseHTML(b)||[];else{if((c=t.clean([b]))&&
c[0]){for(b=c[0];b.parentNode&&11!==b.parentNode.nodeType;)b=b.parentNode;b.parentNode&&b.parentNode.removeChild(b)}}else{var d=a.a.ta(b).toLowerCase();c=w.createElement("div");d=d.match(/^<(thead|tbody|tfoot)/)&&[1,"<table>","</table>"]||!d.indexOf("<tr")&&[2,"<table><tbody>","</tbody></table>"]||(!d.indexOf("<td")||!d.indexOf("<th"))&&[3,"<table><tbody><tr>","</tr></tbody></table>"]||[0,"",""];b="ignored<div>"+d[1]+b+d[2]+"</div>";for("function"==typeof A.innerShiv?c.appendChild(A.innerShiv(b)):
c.innerHTML=b;d[0]--;)c=c.lastChild;c=a.a.R(c.lastChild.childNodes)}return c};a.a.Va=function(b,c){a.a.Fa(b);c=a.a.c(c);if(null!==c&&c!==p)if("string"!=typeof c&&(c=c.toString()),t)t(b).html(c);else for(var d=a.a.Qa(c),e=0;e<d.length;e++)b.appendChild(d[e])}})();a.b("utils.parseHtmlFragment",a.a.Qa);a.b("utils.setHtml",a.a.Va);a.w=function(){function b(c,e){if(c)if(8==c.nodeType){var f=a.w.xb(c.nodeValue);null!=f&&e.push({Rb:c,cc:f})}else if(1==c.nodeType)for(var f=0,h=c.childNodes,g=h.length;f<g;f++)b(h[f],
e)}var c={};return{Na:function(a){if("function"!=typeof a)throw Error("You can only pass a function to ko.memoization.memoize()");var b=(4294967296*(1+Math.random())|0).toString(16).substring(1)+(4294967296*(1+Math.random())|0).toString(16).substring(1);c[b]=a;return"\x3c!--[ko_memo:"+b+"]--\x3e"},Hb:function(a,b){var f=c[a];if(f===p)throw Error("Couldn't find any memo with ID "+a+". Perhaps it's already been unmemoized.");try{return f.apply(null,b||[]),!0}finally{delete c[a]}},Ib:function(c,e){var f=
[];b(c,f);for(var h=0,g=f.length;h<g;h++){var k=f[h].Rb,l=[k];e&&a.a.$(l,e);a.w.Hb(f[h].cc,l);k.nodeValue="";k.parentNode&&k.parentNode.removeChild(k)}},xb:function(a){return(a=a.match(/^\[ko_memo\:(.*?)\]$/))?a[1]:null}}}();a.b("memoization",a.w);a.b("memoization.memoize",a.w.Na);a.b("memoization.unmemoize",a.w.Hb);a.b("memoization.parseMemoText",a.w.xb);a.b("memoization.unmemoizeDomNodeAndDescendants",a.w.Ib);a.Ga={throttle:function(b,c){b.throttleEvaluation=c;var d=null;return a.h({read:b,write:function(a){clearTimeout(d);
d=setTimeout(function(){b(a)},c)}})},rateLimit:function(a,c){var d,e,f;"number"==typeof c?d=c:(d=c.timeout,e=c.method);f="notifyWhenChangesStop"==e?O:N;a.Ma(function(a){return f(a,d)})},notify:function(a,c){a.equalityComparer="always"==c?null:G}};var M={undefined:1,"boolean":1,number:1,string:1};a.b("extenders",a.Ga);a.Fb=function(b,c,d){this.target=b;this.za=c;this.Qb=d;this.sb=!1;a.s(this,"dispose",this.F)};a.Fb.prototype.F=function(){this.sb=!0;this.Qb()};a.N=function(){a.a.sa(this,a.N.fn);this.H=
{}};var F="change";z={V:function(b,c,d){var e=this;d=d||F;var f=new a.Fb(e,c?b.bind(c):b,function(){a.a.ma(e.H[d],f)});e.o&&e.o();e.H[d]||(e.H[d]=[]);e.H[d].push(f);return f},notifySubscribers:function(b,c){c=c||F;if(this.qb(c))try{a.k.jb();for(var d=this.H[c].slice(0),e=0,f;f=d[e];++e)f.sb||f.za(b)}finally{a.k.end()}},Ma:function(b){var c=this,d=a.v(c),e,f,h;c.ia||(c.ia=c.notifySubscribers,c.notifySubscribers=function(a,b){b&&b!==F?"beforeChange"===b?c.bb(a):c.ia(a,b):c.cb(a)});var g=b(function(){d&&
h===c&&(h=c());e=!1;c.Ka(f,h)&&c.ia(f=h)});c.cb=function(a){e=!0;h=a;g()};c.bb=function(a){e||(f=a,c.ia(a,"beforeChange"))}},qb:function(a){return this.H[a]&&this.H[a].length},Wb:function(){var b=0;a.a.A(this.H,function(a,d){b+=d.length});return b},Ka:function(a,c){return!this.equalityComparer||!this.equalityComparer(a,c)},extend:function(b){var c=this;b&&a.a.A(b,function(b,e){var f=a.Ga[b];"function"==typeof f&&(c=f(c,e)||c)});return c}};a.s(z,"subscribe",z.V);a.s(z,"extend",z.extend);a.s(z,"getSubscriptionsCount",
z.Wb);a.a.na&&a.a.ra(z,Function.prototype);a.N.fn=z;a.tb=function(a){return null!=a&&"function"==typeof a.V&&"function"==typeof a.notifySubscribers};a.b("subscribable",a.N);a.b("isSubscribable",a.tb);a.ca=a.k=function(){function b(a){d.push(e);e=a}function c(){e=d.pop()}var d=[],e,f=0;return{jb:b,end:c,zb:function(b){if(e){if(!a.tb(b))throw Error("Only subscribable things can act as dependencies");e.za(b,b.Kb||(b.Kb=++f))}},t:function(a,d,e){try{return b(),a.apply(d,e||[])}finally{c()}},fa:function(){if(e)return e.ba.fa()},
pa:function(){if(e)return e.pa}}}();a.b("computedContext",a.ca);a.b("computedContext.getDependenciesCount",a.ca.fa);a.b("computedContext.isInitial",a.ca.pa);a.m=function(b){function c(){if(0<arguments.length)return c.Ka(d,arguments[0])&&(c.P(),d=arguments[0],c.O()),this;a.k.zb(c);return d}var d=b;a.N.call(c);a.a.sa(c,a.m.fn);c.o=function(){return d};c.O=function(){c.notifySubscribers(d)};c.P=function(){c.notifySubscribers(d,"beforeChange")};a.s(c,"peek",c.o);a.s(c,"valueHasMutated",c.O);a.s(c,"valueWillMutate",
c.P);return c};a.m.fn={equalityComparer:G};var E=a.m.hc="__ko_proto__";a.m.fn[E]=a.m;a.a.na&&a.a.ra(a.m.fn,a.N.fn);a.Ha=function(b,c){return null===b||b===p||b[E]===p?!1:b[E]===c?!0:a.Ha(b[E],c)};a.v=function(b){return a.Ha(b,a.m)};a.ub=function(b){return"function"==typeof b&&b[E]===a.m||"function"==typeof b&&b[E]===a.h&&b.Yb?!0:!1};a.b("observable",a.m);a.b("isObservable",a.v);a.b("isWriteableObservable",a.ub);a.T=function(b){b=b||[];if("object"!=typeof b||!("length"in b))throw Error("The argument passed when initializing an observable array must be an array, or null, or undefined.");
b=a.m(b);a.a.sa(b,a.T.fn);return b.extend({trackArrayChanges:!0})};a.T.fn={remove:function(b){for(var c=this.o(),d=[],e="function"!=typeof b||a.v(b)?function(a){return a===b}:b,f=0;f<c.length;f++){var h=c[f];e(h)&&(0===d.length&&this.P(),d.push(h),c.splice(f,1),f--)}d.length&&this.O();return d},removeAll:function(b){if(b===p){var c=this.o(),d=c.slice(0);this.P();c.splice(0,c.length);this.O();return d}return b?this.remove(function(c){return 0<=a.a.l(b,c)}):[]},destroy:function(b){var c=this.o(),d=
"function"!=typeof b||a.v(b)?function(a){return a===b}:b;this.P();for(var e=c.length-1;0<=e;e--)d(c[e])&&(c[e]._destroy=!0);this.O()},destroyAll:function(b){return b===p?this.destroy(function(){return!0}):b?this.destroy(function(c){return 0<=a.a.l(b,c)}):[]},indexOf:function(b){var c=this();return a.a.l(c,b)},replace:function(a,c){var d=this.indexOf(a);0<=d&&(this.P(),this.o()[d]=c,this.O())}};a.a.r("pop push reverse shift sort splice unshift".split(" "),function(b){a.T.fn[b]=function(){var a=this.o();
this.P();this.kb(a,b,arguments);a=a[b].apply(a,arguments);this.O();return a}});a.a.r(["slice"],function(b){a.T.fn[b]=function(){var a=this();return a[b].apply(a,arguments)}});a.a.na&&a.a.ra(a.T.fn,a.m.fn);a.b("observableArray",a.T);var I="arrayChange";a.Ga.trackArrayChanges=function(b){function c(){if(!d){d=!0;var c=b.notifySubscribers;b.notifySubscribers=function(a,b){b&&b!==F||++f;return c.apply(this,arguments)};var k=[].concat(b.o()||[]);e=null;b.V(function(c){c=[].concat(c||[]);if(b.qb(I)){var d;
if(!e||1<f)e=a.a.Aa(k,c,{sparse:!0});d=e;d.length&&b.notifySubscribers(d,I)}k=c;e=null;f=0})}}if(!b.kb){var d=!1,e=null,f=0,h=b.V;b.V=b.subscribe=function(a,b,d){d===I&&c();return h.apply(this,arguments)};b.kb=function(b,c,l){function h(a,b,c){return r[r.length]={status:a,value:b,index:c}}if(d&&!f){var r=[],m=b.length,q=l.length,s=0;switch(c){case "push":s=m;case "unshift":for(c=0;c<q;c++)h("added",l[c],s+c);break;case "pop":s=m-1;case "shift":m&&h("deleted",b[s],s);break;case "splice":c=Math.min(Math.max(0,
0>l[0]?m+l[0]:l[0]),m);for(var m=1===q?m:Math.min(c+(l[1]||0),m),q=c+q-2,s=Math.max(m,q),B=[],u=[],D=2;c<s;++c,++D)c<m&&u.push(h("deleted",b[c],c)),c<q&&B.push(h("added",l[D],c));a.a.nb(u,B);break;default:return}e=r}}}};a.ba=a.h=function(b,c,d){function e(){q=!0;a.a.A(v,function(a,b){b.F()});v={};x=0;n=!1}function f(){var a=g.throttleEvaluation;a&&0<=a?(clearTimeout(t),t=setTimeout(h,a)):g.wa?g.wa():h()}function h(){if(!r&&!q){if(y&&y()){if(!m){p();return}}else m=!1;r=!0;try{var b=v,d=x;a.k.jb({za:function(a,
c){q||(d&&b[c]?(v[c]=b[c],++x,delete b[c],--d):v[c]||(v[c]=a.V(f),++x))},ba:g,pa:!x});v={};x=0;try{var e=c?s.call(c):s()}finally{a.k.end(),d&&a.a.A(b,function(a,b){b.F()}),n=!1}g.Ka(l,e)&&(g.notifySubscribers(l,"beforeChange"),l=e,g.wa&&!g.throttleEvaluation||g.notifySubscribers(l))}finally{r=!1}x||p()}}function g(){if(0<arguments.length){if("function"===typeof B)B.apply(c,arguments);else throw Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");
return this}n&&h();a.k.zb(g);return l}function k(){return n||0<x}var l,n=!0,r=!1,m=!1,q=!1,s=b;s&&"object"==typeof s?(d=s,s=d.read):(d=d||{},s||(s=d.read));if("function"!=typeof s)throw Error("Pass a function that returns the value of the ko.computed");var B=d.write,u=d.disposeWhenNodeIsRemoved||d.G||null,D=d.disposeWhen||d.Da,y=D,p=e,v={},x=0,t=null;c||(c=d.owner);a.N.call(g);a.a.sa(g,a.h.fn);g.o=function(){n&&!x&&h();return l};g.fa=function(){return x};g.Yb="function"===typeof d.write;g.F=function(){p()};
g.ga=k;var w=g.Ma;g.Ma=function(a){w.call(g,a);g.wa=function(){g.bb(l);n=!0;g.cb(g)}};a.s(g,"peek",g.o);a.s(g,"dispose",g.F);a.s(g,"isActive",g.ga);a.s(g,"getDependenciesCount",g.fa);u&&(m=!0,u.nodeType&&(y=function(){return!a.a.Ea(u)||D&&D()}));!0!==d.deferEvaluation&&h();u&&k()&&u.nodeType&&(p=function(){a.a.u.Ab(u,p);e()},a.a.u.ja(u,p));return g};a.$b=function(b){return a.Ha(b,a.h)};z=a.m.hc;a.h[z]=a.m;a.h.fn={equalityComparer:G};a.h.fn[z]=a.h;a.a.na&&a.a.ra(a.h.fn,a.N.fn);a.b("dependentObservable",
a.h);a.b("computed",a.h);a.b("isComputed",a.$b);(function(){function b(a,f,h){h=h||new d;a=f(a);if("object"!=typeof a||null===a||a===p||a instanceof Date||a instanceof String||a instanceof Number||a instanceof Boolean)return a;var g=a instanceof Array?[]:{};h.save(a,g);c(a,function(c){var d=f(a[c]);switch(typeof d){case "boolean":case "number":case "string":case "function":g[c]=d;break;case "object":case "undefined":var n=h.get(d);g[c]=n!==p?n:b(d,f,h)}});return g}function c(a,b){if(a instanceof Array){for(var c=
0;c<a.length;c++)b(c);"function"==typeof a.toJSON&&b("toJSON")}else for(c in a)b(c)}function d(){this.keys=[];this.ab=[]}a.Gb=function(c){if(0==arguments.length)throw Error("When calling ko.toJS, pass the object you want to convert.");return b(c,function(b){for(var c=0;a.v(b)&&10>c;c++)b=b();return b})};a.toJSON=function(b,c,d){b=a.Gb(b);return a.a.Ya(b,c,d)};d.prototype={save:function(b,c){var d=a.a.l(this.keys,b);0<=d?this.ab[d]=c:(this.keys.push(b),this.ab.push(c))},get:function(b){b=a.a.l(this.keys,
b);return 0<=b?this.ab[b]:p}}})();a.b("toJS",a.Gb);a.b("toJSON",a.toJSON);(function(){a.i={p:function(b){switch(a.a.B(b)){case "option":return!0===b.__ko__hasDomDataOptionValue__?a.a.f.get(b,a.d.options.Pa):7>=a.a.oa?b.getAttributeNode("value")&&b.getAttributeNode("value").specified?b.value:b.text:b.value;case "select":return 0<=b.selectedIndex?a.i.p(b.options[b.selectedIndex]):p;default:return b.value}},X:function(b,c,d){switch(a.a.B(b)){case "option":switch(typeof c){case "string":a.a.f.set(b,a.d.options.Pa,
p);"__ko__hasDomDataOptionValue__"in b&&delete b.__ko__hasDomDataOptionValue__;b.value=c;break;default:a.a.f.set(b,a.d.options.Pa,c),b.__ko__hasDomDataOptionValue__=!0,b.value="number"===typeof c?c:""}break;case "select":if(""===c||null===c)c=p;for(var e=-1,f=0,h=b.options.length,g;f<h;++f)if(g=a.i.p(b.options[f]),g==c||""==g&&c===p){e=f;break}if(d||0<=e||c===p&&1<b.size)b.selectedIndex=e;break;default:if(null===c||c===p)c="";b.value=c}}}})();a.b("selectExtensions",a.i);a.b("selectExtensions.readValue",
a.i.p);a.b("selectExtensions.writeValue",a.i.X);a.g=function(){function b(b){b=a.a.ta(b);123===b.charCodeAt(0)&&(b=b.slice(1,-1));var c=[],d=b.match(e),g,m,q=0;if(d){d.push(",");for(var s=0,B;B=d[s];++s){var u=B.charCodeAt(0);if(44===u){if(0>=q){g&&c.push(m?{key:g,value:m.join("")}:{unknown:g});g=m=q=0;continue}}else if(58===u){if(!m)continue}else if(47===u&&s&&1<B.length)(u=d[s-1].match(f))&&!h[u[0]]&&(b=b.substr(b.indexOf(B)+1),d=b.match(e),d.push(","),s=-1,B="/");else if(40===u||123===u||91===
u)++q;else if(41===u||125===u||93===u)--q;else if(!g&&!m){g=34===u||39===u?B.slice(1,-1):B;continue}m?m.push(B):m=[B]}}return c}var c=["true","false","null","undefined"],d=/^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+\]))$/i,e=RegExp("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|/(?:[^/\\\\]|\\\\.)*/w*|[^\\s:,/][^,\"'{}()/:[\\]]*[^\\s,\"'{}()/:[\\]]|[^\\s]","g"),f=/[\])"'A-Za-z0-9_$]+$/,h={"in":1,"return":1,"typeof":1},g={};return{aa:[],W:g,Ra:b,qa:function(e,l){function f(b,e){var l,k=a.getBindingHandler(b);
if(k&&k.preprocess?e=k.preprocess(e,b,f):1){if(k=g[b])l=e,0<=a.a.l(c,l)?l=!1:(k=l.match(d),l=null===k?!1:k[1]?"Object("+k[1]+")"+k[2]:l),k=l;k&&m.push("'"+b+"':function(_z){"+l+"=_z}");q&&(e="function(){return "+e+" }");h.push("'"+b+"':"+e)}}l=l||{};var h=[],m=[],q=l.valueAccessors,s="string"===typeof e?b(e):e;a.a.r(s,function(a){f(a.key||a.unknown,a.value)});m.length&&f("_ko_property_writers","{"+m.join(",")+" }");return h.join(",")},bc:function(a,b){for(var c=0;c<a.length;c++)if(a[c].key==b)return!0;
return!1},va:function(b,c,d,e,g){if(b&&a.v(b))!a.ub(b)||g&&b.o()===e||b(e);else if((b=c.get("_ko_property_writers"))&&b[d])b[d](e)}}}();a.b("expressionRewriting",a.g);a.b("expressionRewriting.bindingRewriteValidators",a.g.aa);a.b("expressionRewriting.parseObjectLiteral",a.g.Ra);a.b("expressionRewriting.preProcessBindings",a.g.qa);a.b("expressionRewriting._twoWayBindings",a.g.W);a.b("jsonExpressionRewriting",a.g);a.b("jsonExpressionRewriting.insertPropertyAccessorsIntoJson",a.g.qa);(function(){function b(a){return 8==
a.nodeType&&h.test(f?a.text:a.nodeValue)}function c(a){return 8==a.nodeType&&g.test(f?a.text:a.nodeValue)}function d(a,d){for(var e=a,g=1,k=[];e=e.nextSibling;){if(c(e)&&(g--,0===g))return k;k.push(e);b(e)&&g++}if(!d)throw Error("Cannot find closing comment tag to match: "+a.nodeValue);return null}function e(a,b){var c=d(a,b);return c?0<c.length?c[c.length-1].nextSibling:a.nextSibling:null}var f=w&&"\x3c!--test--\x3e"===w.createComment("test").text,h=f?/^\x3c!--\s*ko(?:\s+([\s\S]+))?\s*--\x3e$/:/^\s*ko(?:\s+([\s\S]+))?\s*$/,
g=f?/^\x3c!--\s*\/ko\s*--\x3e$/:/^\s*\/ko\s*$/,k={ul:!0,ol:!0};a.e={Q:{},childNodes:function(a){return b(a)?d(a):a.childNodes},da:function(c){if(b(c)){c=a.e.childNodes(c);for(var d=0,e=c.length;d<e;d++)a.removeNode(c[d])}else a.a.Fa(c)},U:function(c,d){if(b(c)){a.e.da(c);for(var e=c.nextSibling,g=0,k=d.length;g<k;g++)e.parentNode.insertBefore(d[g],e)}else a.a.U(c,d)},yb:function(a,c){b(a)?a.parentNode.insertBefore(c,a.nextSibling):a.firstChild?a.insertBefore(c,a.firstChild):a.appendChild(c)},rb:function(c,
d,e){e?b(c)?c.parentNode.insertBefore(d,e.nextSibling):e.nextSibling?c.insertBefore(d,e.nextSibling):c.appendChild(d):a.e.yb(c,d)},firstChild:function(a){return b(a)?!a.nextSibling||c(a.nextSibling)?null:a.nextSibling:a.firstChild},nextSibling:function(a){b(a)&&(a=e(a));return a.nextSibling&&c(a.nextSibling)?null:a.nextSibling},Xb:b,lc:function(a){return(a=(f?a.text:a.nodeValue).match(h))?a[1]:null},wb:function(d){if(k[a.a.B(d)]){var g=d.firstChild;if(g){do if(1===g.nodeType){var f;f=g.firstChild;
var h=null;if(f){do if(h)h.push(f);else if(b(f)){var q=e(f,!0);q?f=q:h=[f]}else c(f)&&(h=[f]);while(f=f.nextSibling)}if(f=h)for(h=g.nextSibling,q=0;q<f.length;q++)h?d.insertBefore(f[q],h):d.appendChild(f[q])}while(g=g.nextSibling)}}}}})();a.b("virtualElements",a.e);a.b("virtualElements.allowedBindings",a.e.Q);a.b("virtualElements.emptyNode",a.e.da);a.b("virtualElements.insertAfter",a.e.rb);a.b("virtualElements.prepend",a.e.yb);a.b("virtualElements.setDomNodeChildren",a.e.U);(function(){a.J=function(){this.Nb=
{}};a.a.extend(a.J.prototype,{nodeHasBindings:function(b){switch(b.nodeType){case 1:return null!=b.getAttribute("data-bind");case 8:return a.e.Xb(b);default:return!1}},getBindings:function(a,c){var d=this.getBindingsString(a,c);return d?this.parseBindingsString(d,c,a):null},getBindingAccessors:function(a,c){var d=this.getBindingsString(a,c);return d?this.parseBindingsString(d,c,a,{valueAccessors:!0}):null},getBindingsString:function(b){switch(b.nodeType){case 1:return b.getAttribute("data-bind");
case 8:return a.e.lc(b);default:return null}},parseBindingsString:function(b,c,d,e){try{var f=this.Nb,h=b+(e&&e.valueAccessors||""),g;if(!(g=f[h])){var k,l="with($context){with($data||{}){return{"+a.g.qa(b,e)+"}}}";k=new Function("$context","$element",l);g=f[h]=k}return g(c,d)}catch(n){throw n.message="Unable to parse bindings.\nBindings value: "+b+"\nMessage: "+n.message,n;}}});a.J.instance=new a.J})();a.b("bindingProvider",a.J);(function(){function b(a){return function(){return a}}function c(a){return a()}
function d(b){return a.a.Oa(a.k.t(b),function(a,c){return function(){return b()[c]}})}function e(a,b){return d(this.getBindings.bind(this,a,b))}function f(b,c,d){var e,g=a.e.firstChild(c),k=a.J.instance,f=k.preprocessNode;if(f){for(;e=g;)g=a.e.nextSibling(e),f.call(k,e);g=a.e.firstChild(c)}for(;e=g;)g=a.e.nextSibling(e),h(b,e,d)}function h(b,c,d){var e=!0,g=1===c.nodeType;g&&a.e.wb(c);if(g&&d||a.J.instance.nodeHasBindings(c))e=k(c,null,b,d).shouldBindDescendants;e&&!n[a.a.B(c)]&&f(b,c,!g)}function g(b){var c=
[],d={},e=[];a.a.A(b,function y(g){if(!d[g]){var k=a.getBindingHandler(g);k&&(k.after&&(e.push(g),a.a.r(k.after,function(c){if(b[c]){if(-1!==a.a.l(e,c))throw Error("Cannot combine the following bindings, because they have a cyclic dependency: "+e.join(", "));y(c)}}),e.length--),c.push({key:g,pb:k}));d[g]=!0}});return c}function k(b,d,k,f){var h=a.a.f.get(b,r);if(!d){if(h)throw Error("You cannot apply bindings multiple times to the same element.");a.a.f.set(b,r,!0)}!h&&f&&a.Eb(b,k);var l;if(d&&"function"!==
typeof d)l=d;else{var n=a.J.instance,m=n.getBindingAccessors||e,x=a.h(function(){(l=d?d(k,b):m.call(n,b,k))&&k.D&&k.D();return l},null,{G:b});l&&x.ga()||(x=null)}var t;if(l){var w=x?function(a){return function(){return c(x()[a])}}:function(a){return l[a]},z=function(){return a.a.Oa(x?x():l,c)};z.get=function(a){return l[a]&&c(w(a))};z.has=function(a){return a in l};f=g(l);a.a.r(f,function(c){var d=c.pb.init,e=c.pb.update,g=c.key;if(8===b.nodeType&&!a.e.Q[g])throw Error("The binding '"+g+"' cannot be used with virtual elements");
try{"function"==typeof d&&a.k.t(function(){var a=d(b,w(g),z,k.$data,k);if(a&&a.controlsDescendantBindings){if(t!==p)throw Error("Multiple bindings ("+t+" and "+g+") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");t=g}}),"function"==typeof e&&a.h(function(){e(b,w(g),z,k.$data,k)},null,{G:b})}catch(f){throw f.message='Unable to process binding "'+g+": "+l[g]+'"\nMessage: '+f.message,f;}})}return{shouldBindDescendants:t===p}}
function l(b){return b&&b instanceof a.I?b:new a.I(b)}a.d={};var n={script:!0};a.getBindingHandler=function(b){return a.d[b]};a.I=function(b,c,d,e){var g=this,k="function"==typeof b&&!a.v(b),f,h=a.h(function(){var f=k?b():b,l=a.a.c(f);c?(c.D&&c.D(),a.a.extend(g,c),h&&(g.D=h)):(g.$parents=[],g.$root=l,g.ko=a);g.$rawData=f;g.$data=l;d&&(g[d]=l);e&&e(g,c,l);return g.$data},null,{Da:function(){return f&&!a.a.eb(f)},G:!0});h.ga()&&(g.D=h,h.equalityComparer=null,f=[],h.Jb=function(b){f.push(b);a.a.u.ja(b,
function(b){a.a.ma(f,b);f.length||(h.F(),g.D=h=p)})})};a.I.prototype.createChildContext=function(b,c,d){return new a.I(b,this,c,function(a,b){a.$parentContext=b;a.$parent=b.$data;a.$parents=(b.$parents||[]).slice(0);a.$parents.unshift(a.$parent);d&&d(a)})};a.I.prototype.extend=function(b){return new a.I(this.D||this.$data,this,null,function(c,d){c.$rawData=d.$rawData;a.a.extend(c,"function"==typeof b?b():b)})};var r=a.a.f.L(),m=a.a.f.L();a.Eb=function(b,c){if(2==arguments.length)a.a.f.set(b,m,c),
c.D&&c.D.Jb(b);else return a.a.f.get(b,m)};a.xa=function(b,c,d){1===b.nodeType&&a.e.wb(b);return k(b,c,l(d),!0)};a.Lb=function(c,e,g){g=l(g);return a.xa(c,"function"===typeof e?d(e.bind(null,g,c)):a.a.Oa(e,b),g)};a.gb=function(a,b){1!==b.nodeType&&8!==b.nodeType||f(l(a),b,!0)};a.fb=function(a,b){!t&&A.jQuery&&(t=A.jQuery);if(b&&1!==b.nodeType&&8!==b.nodeType)throw Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");b=b||A.document.body;h(l(a),
b,!0)};a.Ca=function(b){switch(b.nodeType){case 1:case 8:var c=a.Eb(b);if(c)return c;if(b.parentNode)return a.Ca(b.parentNode)}return p};a.Pb=function(b){return(b=a.Ca(b))?b.$data:p};a.b("bindingHandlers",a.d);a.b("applyBindings",a.fb);a.b("applyBindingsToDescendants",a.gb);a.b("applyBindingAccessorsToNode",a.xa);a.b("applyBindingsToNode",a.Lb);a.b("contextFor",a.Ca);a.b("dataFor",a.Pb)})();var L={"class":"className","for":"htmlFor"};a.d.attr={update:function(b,c){var d=a.a.c(c())||{};a.a.A(d,function(c,
d){d=a.a.c(d);var h=!1===d||null===d||d===p;h&&b.removeAttribute(c);8>=a.a.oa&&c in L?(c=L[c],h?b.removeAttribute(c):b[c]=d):h||b.setAttribute(c,d.toString());"name"===c&&a.a.Cb(b,h?"":d.toString())})}};(function(){a.d.checked={after:["value","attr"],init:function(b,c,d){function e(){return d.has("checkedValue")?a.a.c(d.get("checkedValue")):b.value}function f(){var g=b.checked,f=r?e():g;if(!a.ca.pa()&&(!k||g)){var h=a.k.t(c);l?n!==f?(g&&(a.a.Y(h,f,!0),a.a.Y(h,n,!1)),n=f):a.a.Y(h,f,g):a.g.va(h,d,"checked",
f,!0)}}function h(){var d=a.a.c(c());b.checked=l?0<=a.a.l(d,e()):g?d:e()==d}var g="checkbox"==b.type,k="radio"==b.type;if(g||k){var l=g&&a.a.c(c())instanceof Array,n=l?e():p,r=k||l;k&&!b.name&&a.d.uniqueName.init(b,function(){return!0});a.ba(f,null,{G:b});a.a.q(b,"click",f);a.ba(h,null,{G:b})}}};a.g.W.checked=!0;a.d.checkedValue={update:function(b,c){b.value=a.a.c(c())}}})();a.d.css={update:function(b,c){var d=a.a.c(c());"object"==typeof d?a.a.A(d,function(c,d){d=a.a.c(d);a.a.ua(b,c,d)}):(d=String(d||
""),a.a.ua(b,b.__ko__cssValue,!1),b.__ko__cssValue=d,a.a.ua(b,d,!0))}};a.d.enable={update:function(b,c){var d=a.a.c(c());d&&b.disabled?b.removeAttribute("disabled"):d||b.disabled||(b.disabled=!0)}};a.d.disable={update:function(b,c){a.d.enable.update(b,function(){return!a.a.c(c())})}};a.d.event={init:function(b,c,d,e,f){var h=c()||{};a.a.A(h,function(g){"string"==typeof g&&a.a.q(b,g,function(b){var h,n=c()[g];if(n){try{var r=a.a.R(arguments);e=f.$data;r.unshift(e);h=n.apply(e,r)}finally{!0!==h&&(b.preventDefault?
b.preventDefault():b.returnValue=!1)}!1===d.get(g+"Bubble")&&(b.cancelBubble=!0,b.stopPropagation&&b.stopPropagation())}})})}};a.d.foreach={vb:function(b){return function(){var c=b(),d=a.a.Sa(c);if(!d||"number"==typeof d.length)return{foreach:c,templateEngine:a.K.Ja};a.a.c(c);return{foreach:d.data,as:d.as,includeDestroyed:d.includeDestroyed,afterAdd:d.afterAdd,beforeRemove:d.beforeRemove,afterRender:d.afterRender,beforeMove:d.beforeMove,afterMove:d.afterMove,templateEngine:a.K.Ja}}},init:function(b,
c){return a.d.template.init(b,a.d.foreach.vb(c))},update:function(b,c,d,e,f){return a.d.template.update(b,a.d.foreach.vb(c),d,e,f)}};a.g.aa.foreach=!1;a.e.Q.foreach=!0;a.d.hasfocus={init:function(b,c,d){function e(e){b.__ko_hasfocusUpdating=!0;var k=b.ownerDocument;if("activeElement"in k){var f;try{f=k.activeElement}catch(h){f=k.body}e=f===b}k=c();a.g.va(k,d,"hasfocus",e,!0);b.__ko_hasfocusLastValue=e;b.__ko_hasfocusUpdating=!1}var f=e.bind(null,!0),h=e.bind(null,!1);a.a.q(b,"focus",f);a.a.q(b,"focusin",
f);a.a.q(b,"blur",h);a.a.q(b,"focusout",h)},update:function(b,c){var d=!!a.a.c(c());b.__ko_hasfocusUpdating||b.__ko_hasfocusLastValue===d||(d?b.focus():b.blur(),a.k.t(a.a.ha,null,[b,d?"focusin":"focusout"]))}};a.g.W.hasfocus=!0;a.d.hasFocus=a.d.hasfocus;a.g.W.hasFocus=!0;a.d.html={init:function(){return{controlsDescendantBindings:!0}},update:function(b,c){a.a.Va(b,c())}};H("if");H("ifnot",!1,!0);H("with",!0,!1,function(a,c){return a.createChildContext(c)});var J={};a.d.options={init:function(b){if("select"!==
a.a.B(b))throw Error("options binding applies only to SELECT elements");for(;0<b.length;)b.remove(0);return{controlsDescendantBindings:!0}},update:function(b,c,d){function e(){return a.a.la(b.options,function(a){return a.selected})}function f(a,b,c){var d=typeof b;return"function"==d?b(a):"string"==d?a[b]:c}function h(c,d){if(r.length){var e=0<=a.a.l(r,a.i.p(d[0]));a.a.Db(d[0],e);m&&!e&&a.k.t(a.a.ha,null,[b,"change"])}}var g=0!=b.length&&b.multiple?b.scrollTop:null,k=a.a.c(c()),l=d.get("optionsIncludeDestroyed");
c={};var n,r;r=b.multiple?a.a.ya(e(),a.i.p):0<=b.selectedIndex?[a.i.p(b.options[b.selectedIndex])]:[];k&&("undefined"==typeof k.length&&(k=[k]),n=a.a.la(k,function(b){return l||b===p||null===b||!a.a.c(b._destroy)}),d.has("optionsCaption")&&(k=a.a.c(d.get("optionsCaption")),null!==k&&k!==p&&n.unshift(J)));var m=!1;c.beforeRemove=function(a){b.removeChild(a)};k=h;d.has("optionsAfterRender")&&(k=function(b,c){h(0,c);a.k.t(d.get("optionsAfterRender"),null,[c[0],b!==J?b:p])});a.a.Ua(b,n,function(c,e,g){g.length&&
(r=g[0].selected?[a.i.p(g[0])]:[],m=!0);e=b.ownerDocument.createElement("option");c===J?(a.a.Xa(e,d.get("optionsCaption")),a.i.X(e,p)):(g=f(c,d.get("optionsValue"),c),a.i.X(e,a.a.c(g)),c=f(c,d.get("optionsText"),g),a.a.Xa(e,c));return[e]},c,k);a.k.t(function(){d.get("valueAllowUnset")&&d.has("value")?a.i.X(b,a.a.c(d.get("value")),!0):(b.multiple?r.length&&e().length<r.length:r.length&&0<=b.selectedIndex?a.i.p(b.options[b.selectedIndex])!==r[0]:r.length||0<=b.selectedIndex)&&a.a.ha(b,"change")});a.a.Tb(b);
g&&20<Math.abs(g-b.scrollTop)&&(b.scrollTop=g)}};a.d.options.Pa=a.a.f.L();a.d.selectedOptions={after:["options","foreach"],init:function(b,c,d){a.a.q(b,"change",function(){var e=c(),f=[];a.a.r(b.getElementsByTagName("option"),function(b){b.selected&&f.push(a.i.p(b))});a.g.va(e,d,"selectedOptions",f)})},update:function(b,c){if("select"!=a.a.B(b))throw Error("values binding applies only to SELECT elements");var d=a.a.c(c());d&&"number"==typeof d.length&&a.a.r(b.getElementsByTagName("option"),function(b){var c=
0<=a.a.l(d,a.i.p(b));a.a.Db(b,c)})}};a.g.W.selectedOptions=!0;a.d.style={update:function(b,c){var d=a.a.c(c()||{});a.a.A(d,function(c,d){d=a.a.c(d);b.style[c]=d||""})}};a.d.submit={init:function(b,c,d,e,f){if("function"!=typeof c())throw Error("The value for a submit binding must be a function");a.a.q(b,"submit",function(a){var d,e=c();try{d=e.call(f.$data,b)}finally{!0!==d&&(a.preventDefault?a.preventDefault():a.returnValue=!1)}})}};a.d.text={init:function(){return{controlsDescendantBindings:!0}},
update:function(b,c){a.a.Xa(b,c())}};a.e.Q.text=!0;a.d.uniqueName={init:function(b,c){if(c()){var d="ko_unique_"+ ++a.d.uniqueName.Ob;a.a.Cb(b,d)}}};a.d.uniqueName.Ob=0;a.d.value={after:["options","foreach"],init:function(b,c,d){function e(){g=!1;var e=c(),f=a.i.p(b);a.g.va(e,d,"value",f)}var f=["change"],h=d.get("valueUpdate"),g=!1;h&&("string"==typeof h&&(h=[h]),a.a.$(f,h),f=a.a.ib(f));!a.a.oa||"input"!=b.tagName.toLowerCase()||"text"!=b.type||"off"==b.autocomplete||b.form&&"off"==b.form.autocomplete||
-1!=a.a.l(f,"propertychange")||(a.a.q(b,"propertychange",function(){g=!0}),a.a.q(b,"focus",function(){g=!1}),a.a.q(b,"blur",function(){g&&e()}));a.a.r(f,function(c){var d=e;a.a.kc(c,"after")&&(d=function(){setTimeout(e,0)},c=c.substring(5));a.a.q(b,c,d)})},update:function(b,c,d){var e=a.a.c(c());c=a.i.p(b);if(e!==c)if("select"===a.a.B(b)){var f=d.get("valueAllowUnset");d=function(){a.i.X(b,e,f)};d();f||e===a.i.p(b)?setTimeout(d,0):a.k.t(a.a.ha,null,[b,"change"])}else a.i.X(b,e)}};a.g.W.value=!0;a.d.visible=
{update:function(b,c){var d=a.a.c(c()),e="none"!=b.style.display;d&&!e?b.style.display="":!d&&e&&(b.style.display="none")}};(function(b){a.d[b]={init:function(c,d,e,f,h){return a.d.event.init.call(this,c,function(){var a={};a[b]=d();return a},e,f,h)}}})("click");a.C=function(){};a.C.prototype.renderTemplateSource=function(){throw Error("Override renderTemplateSource");};a.C.prototype.createJavaScriptEvaluatorBlock=function(){throw Error("Override createJavaScriptEvaluatorBlock");};a.C.prototype.makeTemplateSource=
function(b,c){if("string"==typeof b){c=c||w;var d=c.getElementById(b);if(!d)throw Error("Cannot find template with ID "+b);return new a.n.j(d)}if(1==b.nodeType||8==b.nodeType)return new a.n.Z(b);throw Error("Unknown template type: "+b);};a.C.prototype.renderTemplate=function(a,c,d,e){a=this.makeTemplateSource(a,e);return this.renderTemplateSource(a,c,d)};a.C.prototype.isTemplateRewritten=function(a,c){return!1===this.allowTemplateRewriting?!0:this.makeTemplateSource(a,c).data("isRewritten")};a.C.prototype.rewriteTemplate=
function(a,c,d){a=this.makeTemplateSource(a,d);c=c(a.text());a.text(c);a.data("isRewritten",!0)};a.b("templateEngine",a.C);a.Za=function(){function b(b,c,d,g){b=a.g.Ra(b);for(var k=a.g.aa,l=0;l<b.length;l++){var n=b[l].key;if(k.hasOwnProperty(n)){var r=k[n];if("function"===typeof r){if(n=r(b[l].value))throw Error(n);}else if(!r)throw Error("This template engine does not support the '"+n+"' binding within its templates");}}d="ko.__tr_ambtns(function($context,$element){return(function(){return{ "+a.g.qa(b,
{valueAccessors:!0})+" } })()},'"+d.toLowerCase()+"')";return g.createJavaScriptEvaluatorBlock(d)+c}var c=/(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9\-]+(?:=(?:\"[^\"]*\"|\'[^\']*\'))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi,d=/\x3c!--\s*ko\b\s*([\s\S]*?)\s*--\x3e/g;return{Ub:function(b,c,d){c.isTemplateRewritten(b,d)||c.rewriteTemplate(b,function(b){return a.Za.dc(b,c)},d)},dc:function(a,f){return a.replace(c,function(a,c,d,e,n){return b(n,c,d,f)}).replace(d,function(a,c){return b(c,"\x3c!-- ko --\x3e",
"#comment",f)})},Mb:function(b,c){return a.w.Na(function(d,g){var k=d.nextSibling;k&&k.nodeName.toLowerCase()===c&&a.xa(k,b,g)})}}}();a.b("__tr_ambtns",a.Za.Mb);(function(){a.n={};a.n.j=function(a){this.j=a};a.n.j.prototype.text=function(){var b=a.a.B(this.j),b="script"===b?"text":"textarea"===b?"value":"innerHTML";if(0==arguments.length)return this.j[b];var c=arguments[0];"innerHTML"===b?a.a.Va(this.j,c):this.j[b]=c};var b=a.a.f.L()+"_";a.n.j.prototype.data=function(c){if(1===arguments.length)return a.a.f.get(this.j,
b+c);a.a.f.set(this.j,b+c,arguments[1])};var c=a.a.f.L();a.n.Z=function(a){this.j=a};a.n.Z.prototype=new a.n.j;a.n.Z.prototype.text=function(){if(0==arguments.length){var b=a.a.f.get(this.j,c)||{};b.$a===p&&b.Ba&&(b.$a=b.Ba.innerHTML);return b.$a}a.a.f.set(this.j,c,{$a:arguments[0]})};a.n.j.prototype.nodes=function(){if(0==arguments.length)return(a.a.f.get(this.j,c)||{}).Ba;a.a.f.set(this.j,c,{Ba:arguments[0]})};a.b("templateSources",a.n);a.b("templateSources.domElement",a.n.j);a.b("templateSources.anonymousTemplate",
a.n.Z)})();(function(){function b(b,c,d){var e;for(c=a.e.nextSibling(c);b&&(e=b)!==c;)b=a.e.nextSibling(e),d(e,b)}function c(c,d){if(c.length){var e=c[0],f=c[c.length-1],h=e.parentNode,m=a.J.instance,q=m.preprocessNode;if(q){b(e,f,function(a,b){var c=a.previousSibling,d=q.call(m,a);d&&(a===e&&(e=d[0]||b),a===f&&(f=d[d.length-1]||c))});c.length=0;if(!e)return;e===f?c.push(e):(c.push(e,f),a.a.ea(c,h))}b(e,f,function(b){1!==b.nodeType&&8!==b.nodeType||a.fb(d,b)});b(e,f,function(b){1!==b.nodeType&&8!==
b.nodeType||a.w.Ib(b,[d])});a.a.ea(c,h)}}function d(a){return a.nodeType?a:0<a.length?a[0]:null}function e(b,e,h,n,r){r=r||{};var m=b&&d(b),m=m&&m.ownerDocument,q=r.templateEngine||f;a.Za.Ub(h,q,m);h=q.renderTemplate(h,n,r,m);if("number"!=typeof h.length||0<h.length&&"number"!=typeof h[0].nodeType)throw Error("Template engine must return an array of DOM nodes");m=!1;switch(e){case "replaceChildren":a.e.U(b,h);m=!0;break;case "replaceNode":a.a.Bb(b,h);m=!0;break;case "ignoreTargetNode":break;default:throw Error("Unknown renderMode: "+
e);}m&&(c(h,n),r.afterRender&&a.k.t(r.afterRender,null,[h,n.$data]));return h}var f;a.Wa=function(b){if(b!=p&&!(b instanceof a.C))throw Error("templateEngine must inherit from ko.templateEngine");f=b};a.Ta=function(b,c,h,n,r){h=h||{};if((h.templateEngine||f)==p)throw Error("Set a template engine before calling renderTemplate");r=r||"replaceChildren";if(n){var m=d(n);return a.h(function(){var f=c&&c instanceof a.I?c:new a.I(a.a.c(c)),p=a.v(b)?b():"function"==typeof b?b(f.$data,f):b,f=e(n,r,p,f,h);
"replaceNode"==r&&(n=f,m=d(n))},null,{Da:function(){return!m||!a.a.Ea(m)},G:m&&"replaceNode"==r?m.parentNode:m})}return a.w.Na(function(d){a.Ta(b,c,h,d,"replaceNode")})};a.jc=function(b,d,f,h,r){function m(a,b){c(b,s);f.afterRender&&f.afterRender(b,a)}function q(a,c){s=r.createChildContext(a,f.as,function(a){a.$index=c});var d="function"==typeof b?b(a,s):b;return e(null,"ignoreTargetNode",d,s,f)}var s;return a.h(function(){var b=a.a.c(d)||[];"undefined"==typeof b.length&&(b=[b]);b=a.a.la(b,function(b){return f.includeDestroyed||
b===p||null===b||!a.a.c(b._destroy)});a.k.t(a.a.Ua,null,[h,b,q,f,m])},null,{G:h})};var h=a.a.f.L();a.d.template={init:function(b,c){var d=a.a.c(c());"string"==typeof d||d.name?a.e.da(b):(d=a.e.childNodes(b),d=a.a.ec(d),(new a.n.Z(b)).nodes(d));return{controlsDescendantBindings:!0}},update:function(b,c,d,e,f){var m=c(),q;c=a.a.c(m);d=!0;e=null;"string"==typeof c?c={}:(m=c.name,"if"in c&&(d=a.a.c(c["if"])),d&&"ifnot"in c&&(d=!a.a.c(c.ifnot)),q=a.a.c(c.data));"foreach"in c?e=a.jc(m||b,d&&c.foreach||
[],c,b,f):d?(f="data"in c?f.createChildContext(q,c.as):f,e=a.Ta(m||b,f,c,b)):a.e.da(b);f=e;(q=a.a.f.get(b,h))&&"function"==typeof q.F&&q.F();a.a.f.set(b,h,f&&f.ga()?f:p)}};a.g.aa.template=function(b){b=a.g.Ra(b);return 1==b.length&&b[0].unknown||a.g.bc(b,"name")?null:"This template engine does not support anonymous templates nested within its templates"};a.e.Q.template=!0})();a.b("setTemplateEngine",a.Wa);a.b("renderTemplate",a.Ta);a.a.nb=function(a,c,d){if(a.length&&c.length){var e,f,h,g,k;for(e=
f=0;(!d||e<d)&&(g=a[f]);++f){for(h=0;k=c[h];++h)if(g.value===k.value){g.moved=k.index;k.moved=g.index;c.splice(h,1);e=h=0;break}e+=h}}};a.a.Aa=function(){function b(b,d,e,f,h){var g=Math.min,k=Math.max,l=[],n,p=b.length,m,q=d.length,s=q-p||1,t=p+q+1,u,w,y;for(n=0;n<=p;n++)for(w=u,l.push(u=[]),y=g(q,n+s),m=k(0,n-1);m<=y;m++)u[m]=m?n?b[n-1]===d[m-1]?w[m-1]:g(w[m]||t,u[m-1]||t)+1:m+1:n+1;g=[];k=[];s=[];n=p;for(m=q;n||m;)q=l[n][m]-1,m&&q===l[n][m-1]?k.push(g[g.length]={status:e,value:d[--m],index:m}):
n&&q===l[n-1][m]?s.push(g[g.length]={status:f,value:b[--n],index:n}):(--m,--n,h.sparse||g.push({status:"retained",value:d[m]}));a.a.nb(k,s,10*p);return g.reverse()}return function(a,d,e){e="boolean"===typeof e?{dontLimitMoves:e}:e||{};a=a||[];d=d||[];return a.length<=d.length?b(a,d,"added","deleted",e):b(d,a,"deleted","added",e)}}();a.b("utils.compareArrays",a.a.Aa);(function(){function b(b,c,f,h,g){var k=[],l=a.h(function(){var l=c(f,g,a.a.ea(k,b))||[];0<k.length&&(a.a.Bb(k,l),h&&a.k.t(h,null,[f,
l,g]));k.length=0;a.a.$(k,l)},null,{G:b,Da:function(){return!a.a.eb(k)}});return{S:k,h:l.ga()?l:p}}var c=a.a.f.L();a.a.Ua=function(d,e,f,h,g){function k(b,c){v=r[c];u!==c&&(z[b]=v);v.Ia(u++);a.a.ea(v.S,d);s.push(v);y.push(v)}function l(b,c){if(b)for(var d=0,e=c.length;d<e;d++)c[d]&&a.a.r(c[d].S,function(a){b(a,d,c[d].ka)})}e=e||[];h=h||{};var n=a.a.f.get(d,c)===p,r=a.a.f.get(d,c)||[],m=a.a.ya(r,function(a){return a.ka}),q=a.a.Aa(m,e,h.dontLimitMoves),s=[],t=0,u=0,w=[],y=[];e=[];for(var z=[],m=[],
v,x=0,A,C;A=q[x];x++)switch(C=A.moved,A.status){case "deleted":C===p&&(v=r[t],v.h&&v.h.F(),w.push.apply(w,a.a.ea(v.S,d)),h.beforeRemove&&(e[x]=v,y.push(v)));t++;break;case "retained":k(x,t++);break;case "added":C!==p?k(x,C):(v={ka:A.value,Ia:a.m(u++)},s.push(v),y.push(v),n||(m[x]=v))}l(h.beforeMove,z);a.a.r(w,h.beforeRemove?a.M:a.removeNode);for(var x=0,n=a.e.firstChild(d),E;v=y[x];x++){v.S||a.a.extend(v,b(d,f,v.ka,g,v.Ia));for(t=0;q=v.S[t];n=q.nextSibling,E=q,t++)q!==n&&a.e.rb(d,q,E);!v.Zb&&g&&(g(v.ka,
v.S,v.Ia),v.Zb=!0)}l(h.beforeRemove,e);l(h.afterMove,z);l(h.afterAdd,m);a.a.f.set(d,c,s)}})();a.b("utils.setDomNodeChildrenFromArrayMapping",a.a.Ua);a.K=function(){this.allowTemplateRewriting=!1};a.K.prototype=new a.C;a.K.prototype.renderTemplateSource=function(b){var c=(9>a.a.oa?0:b.nodes)?b.nodes():null;if(c)return a.a.R(c.cloneNode(!0).childNodes);b=b.text();return a.a.Qa(b)};a.K.Ja=new a.K;a.Wa(a.K.Ja);a.b("nativeTemplateEngine",a.K);(function(){a.La=function(){var a=this.ac=function(){if(!t||
!t.tmpl)return 0;try{if(0<=t.tmpl.tag.tmpl.open.toString().indexOf("__"))return 2}catch(a){}return 1}();this.renderTemplateSource=function(b,e,f){f=f||{};if(2>a)throw Error("Your version of jQuery.tmpl is too old. Please upgrade to jQuery.tmpl 1.0.0pre or later.");var h=b.data("precompiled");h||(h=b.text()||"",h=t.template(null,"{{ko_with $item.koBindingContext}}"+h+"{{/ko_with}}"),b.data("precompiled",h));b=[e.$data];e=t.extend({koBindingContext:e},f.templateOptions);e=t.tmpl(h,b,e);e.appendTo(w.createElement("div"));
t.fragments={};return e};this.createJavaScriptEvaluatorBlock=function(a){return"{{ko_code ((function() { return "+a+" })()) }}"};this.addTemplate=function(a,b){w.write("<script type='text/html' id='"+a+"'>"+b+"\x3c/script>")};0<a&&(t.tmpl.tag.ko_code={open:"__.push($1 || '');"},t.tmpl.tag.ko_with={open:"with($1) {",close:"} "})};a.La.prototype=new a.C;var b=new a.La;0<b.ac&&a.Wa(b);a.b("jqueryTmplTemplateEngine",a.La)})()})})();})();

/*
*   Knockout Validation
*   Created By Eric M. Barnard (https://github.com/ericmbarnard)
*
*   Source: https://github.com/ericmbarnard/Knockout-Validation
*   MIT License: http://www.opensource.org/licenses/MIT
*/
(function () {

    if (typeof (ko) === undefined) { throw 'Knockout is required, please ensure it is loaded before loading this validation plug-in'; }

    var defaults = {
        registerExtenders: true,
        messagesOnModified: true,
        messageTemplate: null,
        insertMessages: true,           // automatically inserts validation messages as <span></span>
        parseInputAttributes: false,    // parses the HTML5 validation attribute from a form element and adds that to the object
        writeInputAttributes: false,    // adds HTML5 input validation attributes to form elements that ko observable's are bound to
        decorateElement: false,         // false to keep backward compatibility
        errorClass: null,               // single class for error message and element
        errorElementClass: 'validationElement',  // class to decorate error element
        errorMessageClass: 'validationMessage',  // class to decorate error message
        grouping: {
            deep: false,        //by default grouping is shallow
            observable: true    //and using observables
        }
    };

    // make a copy  so we can use 'reset' later
    var configuration = ko.utils.extend({}, defaults);

    var html5Attributes = ['required', 'pattern', 'min', 'max', 'step'];

    var async = function (expr) {
        if (window.setImmediate) { window.setImmediate(expr); }
        else { window.setTimeout(expr, 0); }
    };

    //#region Utilities

    var utils = (function () {
        var seedId = new Date().getTime();

        var domData = {}; //hash of data objects that we reference from dom elements
        var domDataKey = '__ko_validation__';

        return {
            isArray: function (o) {
                return o.isArray || Object.prototype.toString.call(o) === '[object Array]';
            },
            isObject: function (o) {
                return o !== null && typeof o === 'object';
            },
            values: function (o) {
                var r = [];
                for (var i in o) {
                    if (o.hasOwnProperty(i)) {
                        r.push(o[i]);
                    }
                }
                return r;
            },
            getValue: function (o) {
                return (typeof o === 'function' ? o() : o);
            },
            hasAttribute: function (node, attr) {
                return node.getAttribute(attr) !== null;
            },
            isValidatable: function (o) {
                return o.rules && o.isValid && o.isModified;
            },
            insertAfter: function (node, newNode) {
                node.parentNode.insertBefore(newNode, node.nextSibling);
            },
            newId: function () {
                return seedId += 1;
            },
            getConfigOptions: function (element) {
                var options = utils.contextFor(element);

                return options || configuration;
            },
            setDomData: function (node, data) {
                var key = node[domDataKey];

                if (!key) {
                    node[domDataKey] = key = utils.newId();
                }

                domData[key] = data;
            },
            getDomData: function (node) {
                var key = node[domDataKey];

                if (!key) {
                    return undefined;
                }

                return domData[key];
            },
            contextFor: function (node) {
                switch (node.nodeType) {
                    case 1:
                    case 8:
                        var context = utils.getDomData(node);
                        if (context) return context;
                        if (node.parentNode) return utils.contextFor(node.parentNode);
                        break;
                }
                return undefined;
            },
            isEmptyVal: function (val) {
                if (val === undefined) {
                    return true;
                }
                if (val === null) {
                    return true;
                }
                if (val === "") {
                    return true;
                }
            }
        };
    } ());

    //#endregion

    //#region Public API
    ko.validation = (function () {

        var isInitialized = 0;

        return {
            utils: utils,

            //Call this on startup
            //any config can be overridden with the passed in options
            init: function (options, force) {
                //done run this multiple times if we don't really want to
                if (isInitialized > 0 && !force) {
                    return;
                }

                //becuase we will be accessing options properties it has to be an object at least
                options = options || {};
                //if specific error classes are not provided then apply generic errorClass
                //it has to be done on option so that options.errorClass can override default
                //errorElementClass and errorMessage class but not those provided in options
                options.errorElementClass = options.errorElementClass || options.errorClass || configuration.errorElementClass;
                options.errorMessageClass = options.errorMessageClass || options.errorClass || configuration.errorMessageClass;

                ko.utils.extend(configuration, options);

                if (configuration.registerExtenders) {
                    ko.validation.registerExtenders();
                }

                isInitialized = 1;
            },
            // backwards compatability
            configure: function (options) { ko.validation.init(options); },

            // resets the config back to its original state
            reset: function () { configuration = $.extend(configuration, defaults); },

            // recursivly walks a viewModel and creates an object that
            // provides validation information for the entire viewModel
            // obj -> the viewModel to walk
            // options -> {
            //      deep: false, // if true, will walk past the first level of viewModel properties
            //      observable: false // if true, returns a computed observable indicating if the viewModel is valid
            // }
            group: function group(obj, options) { // array of observables or viewModel
                var options = ko.utils.extend(configuration.grouping, options),
                validatables = ko.observableArray([]),
                result = null,

                //anonymous, immediate function to traverse objects hierarchically
                //if !options.deep then it will stop on top level
                traverse = function traverse(obj, level) {
                    var objValues = [],
                        val = ko.utils.unwrapObservable(obj);

                    //default level value depends on deep option.
                    level = (level !== undefined ? level : options.deep ? 1 : -1);

                    // if object is observable then add it to the list
                    if (ko.isObservable(obj)) {

                        //make sure it is validatable object
                        if (!obj.isValid) obj.extend({ validatable: true });
                        validatables.push(obj);
                    }

                    //get list of values either from array or object but ignore non-objects
                    if (val) {
                        if (utils.isArray(val)) {
                            objValues = val;
                        } else if (utils.isObject(val)) {
                            objValues = utils.values(val);
                        }
                    }

                    //process recurisvely if it is deep grouping
                    if (level !== 0) {
                        ko.utils.arrayForEach(objValues, function (observable) {

                            //but not falsy things and not HTML Elements
                            if (observable && !observable.nodeType) traverse(observable, level + 1);
                        });
                    }
                };

                //if using observables then traverse structure once and add observables
                if (options.observable) {

                    traverse(obj);

                    result = ko.computed(function () {
                        var errors = [];
                        ko.utils.arrayForEach(validatables(), function (observable) {
                            if (!observable.isValid()) {
                                errors.push(observable.error);
                            }
                        });
                        return errors;
                    });

                } else { //if not using observables then every call to error() should traverse the structure
                    result = function () {
                        var errors = [];
                        validatables([]); //clear validatables
                        traverse(obj); // and traverse tree again
                        ko.utils.arrayForEach(validatables(), function (observable) {
                            if (!observable.isValid()) {
                                errors.push(observable.error);
                            }
                        });
                        return errors;
                    };


                }

                result.showAllMessages = function (show) { // thanks @heliosPortal
                    if (show == undefined) //default to true
                        show = true;

                    // ensure we have latest changes
                    result();

                    ko.utils.arrayForEach(validatables(), function (observable) {
                        observable.isModified(show);
                    });
                };

                obj.errors = result;
                obj.isValid = function () {
                    return obj.errors().length === 0;
                };
                obj.isAnyMessageShown = function() {
                    var invalidAndModifiedPresent = false;
                    
                    // ensure we have latest changes
                    result();
                    
                    ko.utils.arrayForEach(validatables(), function (observable) {
                        if (!observable.isValid() && observable.isModified()) {
                            invalidAndModifiedPresent = true;
                        }
                    });
                    return invalidAndModifiedPresent;
                };

                return result;
            },

            formatMessage: function (message, params) {
                return message.replace(/\{0\}/gi, params);
            },

            // addRule:
            // This takes in a ko.observable and a Rule Context - which is just a rule name and params to supply to the validator
            // ie: ko.validation.addRule(myObservable, {
            //          rule: 'required',
            //          params: true
            //      });
            //
            addRule: function (observable, rule) {
                observable.extend({ validatable: true });

                //push a Rule Context to the observables local array of Rule Contexts
                observable.rules.push(rule);
                return observable;
            },

            // addAnonymousRule:
            // Anonymous Rules essentially have all the properties of a Rule, but are only specific for a certain property
            // and developers typically are wanting to add them on the fly or not register a rule with the 'ko.validation.rules' object
            //
            // Example:
            // var test = ko.observable('something').extend{(
            //      validation: {
            //          validator: function(val, someOtherVal){
            //              return true;
            //          },
            //          message: "Something must be really wrong!',
            //          params: true
            //      }
            //  )};
            addAnonymousRule: function (observable, ruleObj) {
                var ruleName = utils.newId();

                if ( ruleObj['message'] === undefined ) {
                    rulesObj['message'] = 'Error';
                }

                //Create an anonymous rule to reference
                ko.validation.rules[ruleName] = ruleObj;

                //add the anonymous rule to the observable
                ko.validation.addRule(observable, {
                    rule: ruleName,
                    params: ruleObj.params
                });
            },

            addExtender: function (ruleName) {
                ko.extenders[ruleName] = function (observable, params) {
                    //params can come in a few flavors
                    // 1. Just the params to be passed to the validator
                    // 2. An object containing the Message to be used and the Params to pass to the validator
                    // 3. A condition when the validation rule to be applied
                    //
                    // Example:
                    // var test = ko.observable(3).extend({
                    //      max: {
                    //          message: 'This special field has a Max of {0}',
                    //          params: 2,
                    //          onlyIf: function() {
                    //                      return specialField.IsVisible();
                    //                  }  
                    //      }
                    //  )};
                    //
                    if (params.message || params.onlyIf) { //if it has a message or condition object, then its an object literal to use
                        return ko.validation.addRule(observable, {
                            rule: ruleName,
                            message: params.message,
                            params: utils.isEmptyVal(params.params) ? true : params.params,
                            condition: params.onlyIf
                        });
                    } else {
                        return ko.validation.addRule(observable, {
                            rule: ruleName,
                            params: params
                        });
                    }
                };
            },

            // loops through all ko.validation.rules and adds them as extenders to
            // ko.extenders
            registerExtenders: function () { // root extenders optional, use 'validation' extender if would cause conflicts
                if (configuration.registerExtenders) {
                    for (var ruleName in ko.validation.rules) {
                        if (ko.validation.rules.hasOwnProperty(ruleName)) {
                            if (!ko.extenders[ruleName]) {
                                ko.validation.addExtender(ruleName);
                            }
                        }
                    }
                }
            },

            //creates a span next to the @element with the specified error class
            insertValidationMessage: function (element) {
                var span = document.createElement('SPAN');
                span.className = utils.getConfigOptions(element).errorMessageClass;
                utils.insertAfter(element, span);
                return span;
            },

            // if html-5 validation attributes have been specified, this parses
            // the attributes on @element
            parseInputValidationAttributes: function (element, valueAccessor) {
                ko.utils.arrayForEach(html5Attributes, function (attr) {
                    if (utils.hasAttribute(element, attr)) {
                        ko.validation.addRule(valueAccessor(), {
                            rule: attr,
                            params: element.getAttribute(attr) || true
                        });
                    }
                });
            },

            // writes html5 validation attributes on the element passed in
            writeInputValidationAttributes: function (element, valueAccessor) {
                var observable = valueAccessor();

                if (!observable || !observable.rules) {
                    return;
                }

                var contexts = observable.rules(); // observable array

                // loop through the attributes and add the information needed
                ko.utils.arrayForEach(html5Attributes, function (attr) {
                    var params;
                    var ctx = ko.utils.arrayFirst(contexts, function (ctx) {
                        return ctx.rule.toLowerCase() === attr.toLowerCase();
                    });

                    if (!ctx)
                        return;

                    params = ctx.params;

                    // we have to do some special things for the pattern validation
                    if (ctx.rule == "pattern") {
                        if (ctx.params instanceof RegExp) {
                            params = ctx.params.source; // we need the pure string representation of the RegExpr without the //gi stuff
                        }
                    }

                    // we have a rule matching a validation attribute at this point
                    // so lets add it to the element along with the params
                    element.setAttribute(attr, params);
                });

                contexts = null;
            }
        };
    } ());
    //#endregion

    //#region Core Validation Rules

    //Validation Rules:
    // You can view and override messages or rules via:
    // ko.validation.rules[ruleName]
    //
    // To implement a custom Rule, simply use this template:
    // ko.validation.rules['<custom rule name>'] = {
    //      validator: function (val, param) {
    //          <custom logic>
    //          return <true or false>;
    //      },
    //      message: '<custom validation message>' //optionally you can also use a '{0}' to denote a placeholder that will be replaced with your 'param'
    // };
    //
    // Example:
    // ko.validation.rules['mustEqual'] = {
    //      validator: function( val, mustEqualVal ){
    //          return val === mustEqualVal;
    //      },
    //      message: 'This field must equal {0}'
    // };
    //
    ko.validation.rules = {};
    ko.validation.rules['required'] = {
        validator: function (val, required) {
            var stringTrimRegEx = /^\s+|\s+$/g,
                testVal;

            if (val === undefined || val === null) {
                return !required;
            }

            testVal = val;
            if (typeof (val) == "string") {
                testVal = val.replace(stringTrimRegEx, '');
            }

            return required && (testVal + '').length > 0;
        },
        message: 'This field is required.'
    };

    ko.validation.rules['min'] = {
        validator: function (val, min) {
            return utils.isEmptyVal(val) || val >= min;
        },
        message: 'Please enter a value greater than or equal to {0}.'
    };

    ko.validation.rules['max'] = {
        validator: function (val, max) {
            return utils.isEmptyVal(val) || val <= max;
        },
        message: 'Please enter a value less than or equal to {0}.'
    };

    ko.validation.rules['minLength'] = {
        validator: function (val, minLength) {
            return utils.isEmptyVal(val) || val.length >= minLength;
        },
        message: 'Please enter at least {0} characters.'
    };

    ko.validation.rules['maxLength'] = {
        validator: function (val, maxLength) {
            return utils.isEmptyVal(val) || val.length <= maxLength;
        },
        message: 'Please enter no more than {0} characters.'
    };

    ko.validation.rules['pattern'] = {
        validator: function (val, regex) {
            return utils.isEmptyVal(val) || val.match(regex) != null;
        },
        message: 'Please check this value.'
    };

    ko.validation.rules['step'] = {
        validator: function (val, step) {

            // in order to handle steps of .1 & .01 etc.. Modulus won't work
            // if the value is a decimal, so we have to correct for that
            return utils.isEmptyVal(val) || (val * 100) % (step * 100) === 0;
        },
        message: 'The value must increment by {0}'
    };

    ko.validation.rules['email'] = {
        validator: function (val, validate) {
            //I think an empty email address is also a valid entry
            //if one want's to enforce entry it should be done with 'required: true'
            return utils.isEmptyVal(val) || (
                validate && /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))$/i.test(val)
            );
        },
        message: 'Please enter a proper email address'
    };

    ko.validation.rules['date'] = {
        validator: function (value, validate) {
            return utils.isEmptyVal(value) || (validate && !/Invalid|NaN/.test(new Date(value)));
        },
        message: 'Please enter a proper date'
    };

    ko.validation.rules['dateISO'] = {
        validator: function (value, validate) {
            return utils.isEmptyVal(value) || (validate && /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(value));
        },
        message: 'Please enter a proper date'
    };
    
    ko.validation.rules['number'] = {
        validator: function (value, validate) {
        	return utils.isEmptyVal(value) || (validate && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value));
        },
        message: 'Please enter a number'
    };

    ko.validation.rules['digit'] = {
        validator: function (value, validate) {
            return utils.isEmptyVal(value) || (validate && /^\d+$/.test(value));
        },
        message: 'Please enter a digit'
    };

    ko.validation.rules['phoneUS'] = {
        validator: function (phoneNumber, validate) {
            if (typeof (phoneNumber) !== 'string') { return false; }
            if (utils.isEmptyVal(phoneNumber)) { return true; } // makes it optional, use 'required' rule if it should be required
            phoneNumber = phoneNumber.replace(/\s+/g, "");
            return validate && phoneNumber.length > 9 && phoneNumber.match(/^(1-?)?(\([2-9]\d{2}\)|[2-9]\d{2})-?[2-9]\d{2}-?\d{4}$/);
        },
        message: 'Please specify a valid phone number'
    };

    ko.validation.rules['equal'] = {
        validator: function (val, params) {
            var otherValue = params;
            return val === utils.getValue(otherValue);
        },
        message: 'Values must equal'
    };

    ko.validation.rules['notEqual'] = {
        validator: function (val, params) {
            var otherValue = params;
            return val !== utils.getValue(otherValue);
        },
        message: 'Please choose another value.'
    };

    //unique in collection
    // options are:
    //    collection: array or function returning (observable) array
    //              in which the value has to be unique
    //    valueAccessor: function that returns value from an object stored in collection
    //              if it is null the value is compared directly
    //    external: set to true when object you are validating is automatically updating collection
    ko.validation.rules['unique'] = {
        validator: function (val, options) {
            var c = utils.getValue(options.collection),
                external = utils.getValue(options.externalValue),
                counter = 0;

            if (!val || !c) return true;

            ko.utils.arrayFilter(ko.utils.unwrapObservable(c), function (item) {
                if (val === (options.valueAccessor ? options.valueAccessor(item) : item)) counter++;
            });
            // if value is external even 1 same value in collection means the value is not unique
            return counter < (external !== undefined && val !== external ? 1 : 2);
        },
        message: 'Please make sure the value is unique.'
    };


    //now register all of these!
    (function () {
        ko.validation.registerExtenders();
    } ());

    //#endregion

    //#region Knockout Binding Handlers

    // The core binding handler
    // this allows us to setup any value binding that internally always
    // performs the same functionality
    ko.bindingHandlers['validationCore'] = (function () {

        return {
            init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                var config = utils.getConfigOptions(element);

                // parse html5 input validation attributes, optional feature
                if (config.parseInputAttributes) {
                    async(function () { ko.validation.parseInputValidationAttributes(element, valueAccessor) });
                }

                // if requested insert message element and apply bindings
                if (config.insertMessages && utils.isValidatable(valueAccessor())) {

                    // insert the <span></span>
                    var validationMessageElement = ko.validation.insertValidationMessage(element);

                    // if we're told to use a template, make sure that gets rendered
                    if (config.messageTemplate) {
                        ko.renderTemplate(config.messageTemplate, { field: valueAccessor() }, null, validationMessageElement, 'replaceNode');
                    } else {
                        ko.applyBindingsToNode(validationMessageElement, { validationMessage: valueAccessor() });
                    }
                }

                // write the html5 attributes if indicated by the config
                if (config.writeInputAttributes && utils.isValidatable(valueAccessor())) {

                    ko.validation.writeInputValidationAttributes(element, valueAccessor);
                }

                // if requested, add binding to decorate element
                if (config.decorateElement && utils.isValidatable(valueAccessor())) {
                    ko.applyBindingsToNode(element, { validationElement: valueAccessor() });
                }
            },

            update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                // hook for future extensibility
            }
        };

    }());

    // override for KO's default 'value' binding
    (function () {
        var init = ko.bindingHandlers['value'].init;

        ko.bindingHandlers['value'].init = function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {

            init(element, valueAccessor, allBindingsAccessor);

            return ko.bindingHandlers['validationCore'].init(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
        };
    } ());


    ko.bindingHandlers['validationMessage'] = { // individual error message, if modified or post binding
        update: function (element, valueAccessor) {
            var obsv = valueAccessor(),
                config = utils.getConfigOptions(element),
                val = ko.utils.unwrapObservable(obsv),
                msg = null,
                isModified = false,
                isValid = false;
                
            obsv.extend({ validatable: true });

            isModified = obsv.isModified();
            isValid = obsv.isValid();
            
            // create a handler to correctly return an error message
            var errorMsgAccessor = function () {
                if (!config.messagesOnModified || isModified) {
                    return isValid ? null : obsv.error;
                } else {
                    return null;
                }
            };

            //toggle visibility on validation messages when validation hasn't been evaluated, or when the object isValid
            var visiblityAccessor = function () {
                return isModified ? !isValid : false;
            };

            ko.bindingHandlers.text.update(element, errorMsgAccessor);
            ko.bindingHandlers.visible.update(element, visiblityAccessor);
        }
    };

    ko.bindingHandlers['validationElement'] = {
        update: function (element, valueAccessor) {
            var obsv = valueAccessor(),
                config = utils.getConfigOptions(element),
                val = ko.utils.unwrapObservable(obsv),
                msg = null,
                isModified = false,
                isValid = false;

            obsv.extend({ validatable: true });

            isModified = obsv.isModified();
            isValid = obsv.isValid();

            // create an evaluator function that will return something like:
            // css: { validationElement: true }
            var cssSettingsAccessor = function () {
                var css = {};

                var shouldShow = (isModified ? !isValid : false);

                if (!config.decorateElement) { shouldShow = false; }

                // css: { validationElement: false }
                css[config.errorElementClass] = shouldShow;

                return css;
            };

            //add or remove class on the element;
            ko.bindingHandlers.css.update(element, cssSettingsAccessor);
        }
    };

    // ValidationOptions:
    // This binding handler allows you to override the initial config by setting any of the options for a specific element or context of elements
    //
    // Example:
    // <div data-bind="validationOptions: { insertMessages: true, messageTemplate: 'customTemplate', errorMessageClass: 'mySpecialClass'}">
    //      <input type="text" data-bind="value: someValue"/>
    //      <input type="text" data-bind="value: someValue2"/>
    // </div>
    ko.bindingHandlers['validationOptions'] = (function () {
        return {
            init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                var options = ko.utils.unwrapObservable(valueAccessor());
                if (options) {
                    var newConfig = ko.utils.extend({}, configuration);
                    ko.utils.extend(newConfig, options);

                    //store the validation options on the node so we can retrieve it later
                    utils.setDomData(element, newConfig);
                }
            }
        };
    } ());
    //#endregion

    //#region Knockout Extenders

    // Validation Extender:
    // This is for creating custom validation logic on the fly
    // Example:
    // var test = ko.observable('something').extend{(
    //      validation: {
    //          validator: function(val, someOtherVal){
    //              return true;
    //          },
    //          message: "Something must be really wrong!',
    //          params: true
    //      }
    //  )};
    ko.extenders['validation'] = function (observable, rules) { // allow single rule or array
        ko.utils.arrayForEach(utils.isArray(rules) ? rules : [rules], function (rule) {
            // the 'rule' being passed in here has no name to identify a core Rule,
            // so we add it as an anonymous rule
            // If the developer is wanting to use a core Rule, but use a different message see the 'addExtender' logic for examples
            ko.validation.addAnonymousRule(observable, rule);
        });
        return observable;
    };

    //This is the extender that makes a Knockout Observable also 'Validatable'
    //examples include:
    // 1. var test = ko.observable('something').extend({validatable: true});
    // this will ensure that the Observable object is setup properly to respond to rules
    //
    // 2. test.extend({validatable: false});
    // this will remove the validation properties from the Observable object should you need to do that.
    ko.extenders['validatable'] = function (observable, enable) {
        if (enable && !utils.isValidatable(observable)) {

            observable.error = null; // holds the error message, we only need one since we stop processing validators when one is invalid

            // observable.rules:
            // ObservableArray of Rule Contexts, where a Rule Context is simply the name of a rule and the params to supply to it
            //
            // Rule Context = { rule: '<rule name>', params: '<passed in params>', message: '<Override of default Message>' }
            observable.rules = ko.observableArray(); //holds the rule Contexts to use as part of validation

            //in case async validation is occuring
            observable.isValidating = ko.observable(false);

            //the true holder of whether the observable is valid or not
            observable.__valid__ = ko.observable(true);

            observable.isModified = ko.observable(false);

            // we use a computed here to ensure that anytime a dependency changes, the
            // validation logic evaluates
            var h_obsValidationTrigger = ko.computed(function () {
                var obs = observable(),
                    ruleContexts = observable.rules();

                ko.validation.validateObservable(observable);

                return true;
            });

            // a semi-protected observable
            observable.isValid = ko.computed(function () {
                return observable.__valid__();
            });

            //subscribe to changes in the observable
            var h_change = observable.subscribe(function () {
                observable.isModified(true);
            });

            observable._disposeValidation = function () {
                //first dispose of the subscriptions
                observable.isValid.dispose();
                observable.rules.removeAll();
                observable.isModified._subscriptions['change'] = [];
                observable.isValidating._subscriptions['change'] = [];
                observable.__valid__._subscriptions['change'] = [];
                h_change.dispose();
                h_obsValidationTrigger.dispose();

                delete observable['rules'];
                delete observable['error'];
                delete observable['isValid'];
                delete observable['isValidating'];
                delete observable['__valid__'];
                delete observable['isModified'];
            };
        } else if (enable === false && utils.isValidatable(observable)) {

            if (observable._disposeValidation) {
                observable._disposeValidation();
            }
        }
        return observable;
    };

    function validateSync(observable, rule, ctx) {
        //Execute the validator and see if its valid
        if (!rule.validator(observable(), ctx.params === undefined ? true : ctx.params)) { // default param is true, eg. required = true

            //not valid, so format the error message and stick it in the 'error' variable
            observable.error = ko.validation.formatMessage(ctx.message || rule.message, ctx.params);
            observable.__valid__(false);
            return false;
        } else {
            return true;
        }
    }

    function validateAsync(observable, rule, ctx) {
        observable.isValidating(true);

        var callBack = function (valObj) {
            var isValid = false,
                msg = '';

            if (!observable.__valid__()) {

                // since we're returning early, make sure we turn this off
                observable.isValidating(false);

                return; //if its already NOT valid, don't add to that
            }

            //we were handed back a complex object
            if (valObj['message']) {
                isValid = valObj.isValid;
                msg = valObj.message;
            } else {
                isValid = valObj;
            }

            if (!isValid) {
                //not valid, so format the error message and stick it in the 'error' variable
                observable.error = ko.validation.formatMessage(msg || ctx.message || rule.message, ctx.params);
                observable.__valid__(isValid);
            }

            // tell it that we're done
            observable.isValidating(false);
        };

        //fire the validator and hand it the callback
        rule.validator(observable(), ctx.params || true, callBack);
    }

    ko.validation.validateObservable = function (observable) {
        var i = 0,
            rule, // the rule validator to execute
            ctx, // the current Rule Context for the loop
            ruleContexts = observable.rules(), //cache for iterator
            len = ruleContexts.length; //cache for iterator

        for (; i < len; i++) {

            //get the Rule Context info to give to the core Rule
            ctx = ruleContexts[i];

            // checks an 'onlyIf' condition
            if (ctx.condition && !ctx.condition())
                continue;

            //get the core Rule to use for validation
            rule = ko.validation.rules[ctx.rule];

            if (rule['async'] || ctx['async']) {
                //run async validation
                validateAsync(observable, rule, ctx);

            } else {
                //run normal sync validation
                if (!validateSync(observable, rule, ctx)) {
                    return false; //break out of the loop
                }
            }
        }
        //finally if we got this far, make the observable valid again!
        observable.error = null;
        observable.__valid__(true);
        return true;
    };

    //#endregion

    //#region Validated Observable

    ko.validatedObservable = function (initialValue) {
        if (!ko.validation.utils.isObject(initialValue)) { return ko.observable(initialValue).extend({ validatable: true }); }

        var obsv = ko.observable(initialValue);
        obsv.errors = ko.validation.group(initialValue);
        obsv.isValid = ko.computed(function () {
            return obsv.errors().length === 0;
        });

        return obsv;
    };

    //#endregion

    //#region Localization

    //quick function to override rule messages
    ko.validation.localize = function (msgTranslations) {

        var msg, rule;

        //loop the properties in the object and assign the msg to the rule
        for (rule in msgTranslations) {
            if (ko.validation.rules.hasOwnProperty(rule)) {
                ko.validation.rules[rule].message = msgTranslations[rule];
            }
        }
    };
    //#endregion

    //#region ApplyBindings Added Functionality
    ko.applyBindingsWithValidation = function (viewModel, rootNode, options) {
        var len = arguments.length,
            node, config;

        if (len > 2) { // all parameters were passed
            node = rootNode;
            config = options;
        } else if (len < 2) {
            node = document.body;
        } else { //have to figure out if they passed in a root node or options
            if (arguments[1].nodeType) { //its a node
                node = rootNode;
            } else {
                config = arguments[1];
            }
        }

        ko.validation.init();

        if (config) { ko.validation.utils.setDomData(node, config); }

        ko.applyBindings(viewModel, rootNode);
    };

    //override the original applyBindings so that we can ensure all new rules and what not are correctly registered
    var origApplyBindings = ko.applyBindings;
    ko.applyBindings = function (viewModel, rootNode) {

        ko.validation.init();

        origApplyBindings(viewModel, rootNode);
    };

    //#endregion

})();

if (false && navigator.userAgent.match(/IEMobile\/10\.0/)) {
	var msViewportStyle = document.createElement("style");
	var mq = "@@-ms-viewport{width:auto!important}";
	msViewportStyle.appendChild(document.createTextNode(mq));
	document.getElementsByTagName("head")[0].appendChild(msViewportStyle);
};
define('services/logger', ['durandal/system'],
    function (system) {
    	var logger = {
    		log: log,
    		logError: logError,
    		error: error,
    		info: info,
    		success: success,
    		warning: warning,
    	};

    	return logger;

    	function log(message, data, source, showToast) {
    		logIt(message, data, source, showToast, 'info');
    	}

    	function logError(message, data, source, showToast) {
    		logIt(message, data, source, showToast, 'error');
    	}

    	function logIt(message, data, source, showToast, toastType) {
    		source = source ? '[' + source + '] ' : '';
    		if (data) {
    			system.log(source, message, data);
    		} else {
    			system.log(source, message);
    		}
    		//if (showToast) {
    		//	if (toastType === 'error') {
    		//		toastr.error(message);
    		//	} else {
    		//		toastr.info(message);
    		//	}

    		//}

    	}
    	function log2() {
    		var console = window.console;
    		!!console && console.log && console.log.apply && console.log.apply(console, arguments);
    	}
    	function error(message, title) {
    		//toastr.error(message, title);
    		log2("Error: " + message);
    	};
    	function info(message, title) {
    		//toastr.info(message, title);
    		log2("Info: " + message);
    	};
    	function success(message, title) {
    		//toastr.success(message, title);
    		log2("Success: " + message);
    	};
    	function warning(message, title) {
    		//toastr.warning(message, title);
    		log2("Warning: " + message);
    	};
    });
/// <reference path="../gv/messages.en.js" />
var appConfig = appConfig || {};
(function (appConfig) {
	var i = 1;
	appConfig.initLang = function () {
		$.each(appConfig.messages, function (key, value) {
			value.t = value.t || key;
			value.pt = value.pt || key;
			value.f = typeof key == "string" && key.indexOf('{') >= 0;
			appConfig.messages[i] = value;
		});
		return $.extend(window, {
			_: _,
			_s: _s
		});
	}
	var htmlEncoder = $('<b/>');
	return $.extend(window, {
		_: _,
		__: __,
		___: ___,
		_s: _s,
		__s: __s,
		___s: ___s,
		__q: __q,
		___q: ___q
	});
	function _(message, args) {
		/// <summary>Gets the translated version of the message formmated with any given args</summary>
		/// <param name="message" type="String">The message key to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = translation && translation.t;
		translation = translation || message;
		var a = arguments;
		Array.prototype.forEach.call(a, function (arg, i) {
			i && (a[i] = htmlEncoder.text(arg).html());
		});
		message = htmlEncoder.text(translation).html();
		return hasFormat ? String.format.apply(this, arguments) : translation;
	}

	function __(message, args) {
		/// <summary>Gets the translated version of the message formmated with any given args</summary>
		/// <param name="message" type="String">The message key to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = translation && translation.t;
		translation = translation || message;
		message = translation;
		var a = arguments;
		Array.prototype.forEach.call(a, function (arg, i) {
			i && (a[i] = htmlEncoder.text(arg).html());
		});
		return hasFormat ? String.format.apply(this, arguments) : translation;
	}


	function ___(message, args) {
		/// <summary>Gets the translated version of the message formmated with any given args</summary>
		/// <param name="message" type="String">The message key to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = translation && translation.t;
		translation = translation || message;
		message = translation;

		return hasFormat ? String.format.apply(this, arguments) : translation;
	}

	function _s(singular, plural, count) {
		/// <summary>Gets the translated version of the message for both singular and plural formmated with any given args</summary>
		/// <param name="singular" type="String">The singular message to be translated</param>
		/// <param name="plural" type="String">The plural message to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>

		var message = count == 1 ? singular : plural;
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = count != 1 ? translation.pt : translation.t;
		translation = translation || (count != 1 ? plural : singular);
		plural = translation;

		var a = arguments;
		Array.prototype.forEach.call(a, function (arg, i) {
			i && (a[i] = htmlEncoder.text(arg).html());
		});

		translation = htmlEncoder.text(translation).html();

		if (hasFormat) {
			Array.prototype.unshift.call(arguments);
			return String.format.apply(this, arguments);
		}
		return translation;
	}

	function __s(singular, plural, count) {

		/// <summary>Gets the translated version of the message for both singular and plural formmated with any given args</summary>
		/// <param name="singular" type="String">The singular message to be translated</param>
		/// <param name="plural" type="String">The plural message to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>

		var message = count == 1 ? singular : plural;
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = count != 1 ? translation.pt : translation.t;
		translation = translation || (count != 1 ? plural : singular);
		plural = translation;

		var a = arguments;
		Array.prototype.forEach.call(a, function (arg, i) {
			i && (a[i] = htmlEncoder.text(arg).html());
		});

		if (hasFormat) {
			Array.prototype.unshift.call(arguments);
			return String.format.apply(this, arguments);
		}
		return translation;
	}

	function ___s(singular, plural, count) {
		/// <summary>Gets the translated version of the message for both singular and plural formmated with any given args</summary>
		/// <param name="singular" type="String">The singular message to be translated</param>
		/// <param name="plural" type="String">The plural message to be translated</param>
		/// <param name="args" type="Object" parameterArray="true" optional="true">Specify arguments so that the message will be formmated i.e. {0}, {1} - similar to string.format("Hello {0}", user)</param>

		var message = count == 1 ? singular : plural;
		var translation = message in appConfig.messages ? appConfig.messages[message] : message;
		var hasFormat = !translation || translation && translation.f !== false;
		translation = count != 1 ? translation.pt : translation.t;
		translation = translation || (count != 1 ? plural : singular);
		plural = translation;

		if (hasFormat) {
			Array.prototype.unshift.call(arguments);
			return String.format.apply(this, arguments);
		}
		return translation;
	}

	function __q(message, args) {
		return '&quot;' + __(message, args) + '&quot;';
	}

	function ___q(message, args) {
		return '&quot;' + ___(message, args) + '&quot;';
	}


})(appConfig);

/*!
 * $.fn.scrollIntoView - similar to the default browser scrollIntoView
 * The default browser behavior always places the element at the top or bottom of its container. 
 * This override is smart enough to not scroll if the element is already visible.
 *
 * Copyright 2011 Arwid Bancewicz
 * Licensed under the MIT license
 * http://www.opensource.org/licenses/mit-license.php
 * 
 * @date 8 Jan 2013
 * @author Arwid Bancewicz http://arwid.ca
 * @version 0.3
 */
(function ($) {
	$.easing && ($.easing.easeOutExpo = function (x, t, b, c, d) {
		//console.log("x1234")
		return (t == d) ? b + c : c * (-Math.pow(2, -10 * t / d) + 1) + b;
	});
	$.noop = $.noop || function () { };
	$.fn.scrollIntoView = function (duration, easing, complete) {
		// The arguments are optional.
		// The first argment can be false for no animation or a duration.
		// The first argment could also be a map of options.
		// Refer to http://api.jquery.com/animate/.
		if (this.length == 0) {
			return this;
		}
		var opts = $.extend({},
        $.fn.scrollIntoView.defaults);

		// Get options
		if ($.type(duration) == "object") {
			$.extend(opts, duration);
		} else if ($.type(duration) == "number") {
			$.extend(opts, { duration: duration, easing: easing, complete: complete });
		} else if (duration == false) {
			opts.smooth = false;
		}
		// get enclosing offsets
		var elY = Infinity, elH = 0;
		if (this.size() == 1) ((elY = this.get(0).offsetTop) == null || (elH = elY + this.get(0).offsetHeight));
		else this.each(function (i, el) { (el.offsetTop < elY ? elY = el.offsetTop : el.offsetTop + el.offsetHeight > elH ? elH = el.offsetTop + el.offsetHeight : null) });
		elH -= elY;

		// start from the common ancester
		var pEl = this.commonAncestor().get(0);

		var wH = $(window).height();

		// go up parents until we find one that scrolls
		while (pEl) {
			var pY = pEl.scrollTop, pH = pEl.clientHeight;
			if (pH > wH) pH = wH;

			// case: if body's elements are all absolutely/fixed positioned, use window height
			if (pH == 0 && pEl.tagName == "BODY") pH = wH;

			if (
				// it wiggles?
            (pEl.scrollTop != ((pEl.scrollTop += 1) == null || pEl.scrollTop) && (pEl.scrollTop -= 1) != null) ||
            (pEl.scrollTop != ((pEl.scrollTop -= 1) == null || pEl.scrollTop) && (pEl.scrollTop += 1) != null)) {
				if ((opts.alignWithTop && (elY + elH) > (pY + pH)) || elY <= pY) scrollTo(pEl, elY); // scroll up
				else if ((elY + elH) > (pY + pH)) scrollTo(pEl, elY + elH - pH); // scroll down
				else scrollTo(pEl, undefined) // no scroll
				return this;
			}

			// try next parent
			pEl = pEl.parentNode;
		}

		function scrollTo(el, scrollTo) {
			if (scrollTo === undefined) {
				if ($.isFunction(opts.complete)) opts.complete.call(el);
			} else if (opts.smooth) {
				$(el).stop().animate({ scrollTop: scrollTo + opts.offset }, opts);
			} else {
				el.scrollTop = scrollTo + opts.offset;
				if ($.isFunction(opts.complete)) opts.complete.call(el);
			}
		}
		return this;
	};

	$.fn.scrollIntoView.defaults = {
		smooth: true,
		duration: null,
		easing: $.easing && $.easing.easeOutExpo ? 'easeOutExpo' : null,
		// Note: easeOutExpo requires jquery.effects.core.js
		//       otherwise jQuery will default to use 'swing'
		complete: $.noop(),
		step: null,
		specialEasing: {}, // cannot be null in jQuery 1.8.3
		alignWithTop: false,
		offset: 0
	};

	/*
     Returns whether the elements are in view
    */
	$.fn.isOutOfView = function (completely) {
		// completely? whether element is out of view completely
		var outOfView = true;
		this.each(function () {
			if (!this.parentNode) {
				outOfView = true;
				return false;
			}
			var pEl = this.parentNode, pY = pEl.scrollTop, pH = pEl.clientHeight, elY = this.offsetTop, elH = this.offsetHeight;
			if (completely ? (elY) > (pY + pH) : (elY + elH) > (pY + pH)) { }
			else if (completely ? (elY + elH) < pY : elY < pY) { }
			else {
				outOfView = false;
				return false;
			}
		});
		return outOfView;
	};

	/*
     Returns the common ancestor of the elements.
     It was taken from http://stackoverflow.com/questions/3217147/jquery-first-parent-containing-all-children
     It has received minimal testing.
    */
	$.fn.commonAncestor = function () {
		var parents = [];
		var minlen = Infinity;

		$(this).each(function () {
			var curparents = $(this).parents();
			parents.push(curparents);
			minlen = Math.min(minlen, curparents.length);
		});

		for (var i = 0; i < parents.length; i++) {
			parents[i] = parents[i].slice(parents[i].length - minlen);
		}

		if (parents[0])
		// Iterate until equality is found
		for (var i = 0; i < parents[0].length; i++) {
			var equal = true;
			for (var j = 0; j < parents.length; j++) {
				if (parents[j][i] != parents[0][i]) {
					equal = false;
					break;
				}
			}
			if (equal) return $(parents[0][i]);
		}
		return $([]);
	}
	if ($.isFunction(window.define))
		define("jquery.scrollIntoView", [],function() { return $.fn.scrollIntoView; });
})(jQuery);
/** @license
 * RequireJS plugin for async dependency load like JSONP and Google Maps
 * Author: Miller Medeiros
 * Version: 0.1.1 (2011/11/17)
 * Released under the MIT license
 */
define('async', [
], function () {
	var DEFAULT_PARAM_NAME = 'callback';
	//console.log("AXXXXXXXXXXXXXX")
	//console.log((window.navigator && navigator.onLine === false) + ":aaaaaaaaaaaaaaaaaa:");
	var _uid = 0;
	var appliedBindings = 0;
	function injectScriptJS(src) {
		var s, t;
		s = document.createElement('script'); s.type = 'text/javascript'; s.async = true; s.src = src;
		t = document.getElementsByTagName('script')[0]; t.parentNode.insertBefore(s, t);
		var dfd = $.Deferred();
		s.onload = function () {
			dfd.resolve();
		};
		s.onerror = function () {
			dfd.reject();
		}
		return dfd;
	}
    function injectScriptJSONP(src, id) {
    	!appliedBindings++ && ko.applyBindings(window, $("#splash-container")[0]);
		//console.log(navigator && navigator.onLine === false + ":aaaaaaaaaaaaaaaaaa:" + connection);
		if (!isOnline()) {
			window.showSplash && showSplash(_("You are not connected to the internet. Please enable a connection and tap to retry."));
			return false;
		}
		return $.ajax({
			url: src,
			async: true,
			type: 'GET',
			dataType: 'jsonp',
			//crossDomain: false,
			jsonpCallback: id,
		}).done(function (data, status, xmlHttpRequest) {
			//if (!window.glimps && xmlHttpRequest && xmlHttpRequest.getResponseHeader) {
			//	var gh = xmlHttpRequest.getResponseHeader('Glimpse-RequestID');
			//	var url = (appConfig.ssl ? "https://" : "http://") + appConfig.domain;
			//	var hash = "aa86a04c";
			//	$.getScript("{0}/Glimpse.axd?n=glimpse_client&hash={1}".format(url, hash), function () {
			//		window.glimpse_data_initMetadata = function (metadata) {
			//			console.warn(metadata);
			//			metadata && $.each(metadata.resources, function (key, value) {
			//				metadata.resources[key] = url + value;
			//			});
			//			return glimpse.data.initMetadata(metadata);
			//		}
			//		$.getScript("{0}/Glimpse.axd?n=glimpse_metadata&hash={1}&callback=glimpse_data_initMetadata".format(url, hash), function () {
			//			$.getScript("{0}/Glimpse.axd?n=glimpse_request&requestId={2}&hash=aa86a04c&callback=glimpse.data.initData".format(url, hash, gh));
			//		});
			//	});
			//}
		});
		//var s, t;
		//s = document.createElement('script'); s.type = 'text/javascript'; s.async = true; s.src = src;
		//t = document.getElementsByTagName('script')[0]; t.parentNode.insertBefore(s, t);
	}
	
	function formatUrl(name, id) {
		var paramRegex = /!(.+)/,
            url = name.replace(paramRegex, ''),
            param = (paramRegex.test(name)) ? name.replace(/.+!/, '') : DEFAULT_PARAM_NAME;
		url += (url.indexOf('?') < 0) ? '?' : '&';
		return url + param + '=' + id;
	}

	function uid() {
		_uid += 1;
		return '__async_req_' + _uid + '__';
	}

	return {
		load: function (name, req, onLoad, config) {
			if (config.isBuild) {
				onLoad(null); //avoid errors on the optimizer
			} else {
				var id = uid();
				//create a global variable that stores onLoad so callback
				//function can define new module after async load
				//window[id] = onLoad;
				//injectScript(formatUrl(name, id));
				var inj = appliedBindings ? injectScriptJS(name, id) : injectScriptJSONP(name, id);
				if (!inj) { 
					console.warn("injectScript returned", inj, "for name", name, "and id", id);
				}
				inj && inj.done(function (data) {
					onLoad.apply(this, arguments);
				});;
			}
		}
	};
});

/**
 * @license RequireJS text 2.0.3 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require: false, XMLHttpRequest: false, ActiveXObject: false,
  define: false, window: false, process: false, Packages: false,
  java: false, location: false */

define('text', ['module'], function (module) {
	

	var text, fs,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = [],
        masterConfig = (module.config && module.config()) || {};
	var scriptRegex = /<script(.|\r|\n)*?\<\/script>(\s|\r|\n)*/gi;
	function scriptRegexReplacer(script, content, whitespace, offset, str) {
		var id = $(script).inject().attr("id");
		return str == script ? id : '';
	}
	function TXT(content) {
		content = content.replace(scriptRegex, scriptRegexReplacer);
		return content;
	}
	if (typeof window != "undefined")
		window.TXT = TXT;

	//localizable patterns
	var regexLocalizable = /\!([*0-9]{1})(_|__|___|_s|__s|___s|__q|___q)\(([\S\s]*?)\)\1\!/g;
	var regexStringArgs = /((?:\s*)~([\S\s]*?)~(?:\s*)|((?:\s*)(undefined|null|true|false|\d+|(?:\d*?\.\d+f?))(?:\s*)))(,|$)/gi;

	text = {
		version: '2.0.3.1',

		strip: function (content) {
			//Strips <?xml ...?> declarations so that external SVG and XML
			//documents can be added to a document without worry. Also, if the string
			//is an HTML document, only the part inside the body tag is returned.
			if (content) {
				content = content.replace(xmlRegExp, "");
				var matches = content.match(bodyRegExp);
				if (matches) {
					content = matches[1];
				}
			} else {
				content = "";
			}
			return content;
		},

		jsEscape: function (content) {
			return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
		},

		createXhr: masterConfig.createXhr || function () {
			//Would love to dump the ActiveX crap in here. Need IE 6 to die first.
			var xhr, i, progId;
			if (!(typeof ActiveXObject !== "undefined" && /file\:/i.test(location.protocol)) && typeof XMLHttpRequest !== "undefined") {
				return new XMLHttpRequest();
			} else if (typeof ActiveXObject !== "undefined") {
				for (i = 0; i < 3; i += 1) {
					progId = progIds[i];
					try {
						xhr = new ActiveXObject(progId);
					} catch (e) { }

					if (xhr) {
						progIds = [progId];  // so faster next time
						break;
					}
				}
			}

			return xhr;
		},

		/**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
		parseName: function (name) {
			var strip = false, index = name.indexOf("."),
                modName = name.substring(0, index),
                ext = name.substring(index + 1, name.length);

			index = ext.indexOf("!");
			if (index !== -1) {
				//Pull off the strip arg.
				strip = ext.substring(index + 1, ext.length);
				strip = strip === "strip";
				ext = ext.substring(0, index);
			}

			return {
				moduleName: modName,
				ext: ext,
				strip: strip
			};
		},

		xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

		/**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
		useXhr: function (url, protocol, hostname, port) {
			if (/https?/i.test((window.appConfig.relative || '')))
				return true;
			var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
			if (!match) {
				return true;
			}
			uProtocol = match[2];
			uHostName = match[3];

			uHostName = uHostName.split(':');
			uPort = uHostName[1];
			uHostName = uHostName[0];

			return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
		},

		finishLoad: function (name, strip, content, onLoad) {
			content = strip ? text.strip(content) : content;
			if (masterConfig.isBuild) {
				buildMap[name] = content;
			}
			//console.log(content);
			//var testS = '<div>!*_( ~T{0}~ , \n~!1_(~moun-\nt{0}in~, ~A,~)1!~)*!</div>';
			//console.log("original testS: ", testS);
			//testS = this.replaceRegEx(testS, regexLocalizable, regexStringArgs);
			if (typeof window != "undefined") {
				content = this.replaceRegEx(content, regexLocalizable, regexStringArgs);
				content = TXT(content);
			}
			//console.warn("FINAL testS: ", testS);
			//console.log(content);
			onLoad(content);
		},
		replaceRegEx: function (content, regex, regexStringArgs) {
			var self = this;
			//console.log("0 content: " + content);
			content = content.replace(regex, function (match, nestingLevel, method, stringArgs) {
				//console.log("arguments: ", arguments);
				var args = [];
				//console.log("1 match: " + match + " nestingLevel: " + nestingLevel + " method: " + method + " stringArgs: " + stringArgs);
				if (/(~\![*0-9])/.test(match)) {
					stringArgs = self.replaceRegEx(stringArgs, regex, regexStringArgs);
				}
				stringArgs && stringArgs.replace(regexStringArgs, function (match, expr, string, nonString) {
					//console.log("2 match: " + match + " expr: " + expr + " string: " + string + " nonString: " + nonString);
					args.push(string || nonString);
				});
				if (args.length > 0) {
					//console.log("translating using " + method + " : ", args);
					return window[method].apply(this, args)
						.replace(/,/g, '!#2C;'); //encode commas (,)
				}
			});
			//console.log("3 content: ", content);

			return content
				.replace(/!#2C;/g, ',') //decode commas (,)
				.replace(/!#126;/g, '~'); //decode tilda chars (~)
		},

		load: function (name, req, onLoad, config) {
			//Name has format: some.module.filext!strip
			//The strip part is optional.
			//if strip is present, then that means only get the string contents
			//inside a body tag in an HTML string. For XML/SVG content it means
			//removing the <?xml ...?> declarations so the content can be inserted
			//into the current doc without problems.

			// Do not bother with the work if a build and text will
			// not be inlined.
			if (typeof window != "undefined" && window.intellisense || config.isBuild && !config.inlineText) {
				onLoad('');
				return;
			}

			masterConfig.isBuild = config.isBuild;

			var parsed = text.parseName(name),
                nonStripName = parsed.moduleName + '.' + parsed.ext,
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

			//Load the text. Use XHR if possible and in a browser.
			if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
				text.get(url, function (content) {
					text.finishLoad(name, parsed.strip, content, onLoad);
				}, function (err) {
					if (onLoad.error) {
						onLoad.error(err);
					}
				});
			} else {
				//Need to fetch the resource across domains. Assume
				//the resource has been optimized into a JS module. Fetch
				//by the module name + extension, but do not include the
				//!strip part to avoid file system issues.
				req([nonStripName], function (content) {
					text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
				});
			}
		},

		write: function (pluginName, moduleName, write, config) {
			if (buildMap.hasOwnProperty(moduleName)) {
				var content = text.jsEscape(buildMap[moduleName]);
				content = replaceRegEx_r_js("'"+content+"'", regexLocalizable, regexStringArgs, moduleName, "'");
				write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return TXT(" +
                                   content +
                               ");});\n");
			}
		},

		writeFile: function (pluginName, moduleName, req, write, config) {
			var parsed = text.parseName(moduleName),
                nonStripName = parsed.moduleName + '.' + parsed.ext,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + '.' +
                                     parsed.ext) + '.js';

			//Leverage own load() method to load plugin value, but only
			//write out values that do not have the strip argument,
			//to avoid any potential issues with ! in file names.
			text.load(nonStripName, req, function (value) {
				//Use own write() method to construct full module value.
				//But need to create shell that translates writeFile's
				//write() to the right interface.
				var textWrite = function (contents) {
					return write(fileName, contents);
				};
				textWrite.asModule = function (moduleName, contents) {
					return write.asModule(moduleName, fileName, contents);
				};

				text.write(pluginName, nonStripName, textWrite, config);
			}, config);
		},
	};

	if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node)) {
		//Using special require.nodeRequire, something added by r.js.
		fs = require.nodeRequire('fs');

		text.get = function (url, callback) {
			var file = fs.readFileSync(url, 'utf8');
			//Remove BOM (Byte Mark Order) from utf8 files if it is there.
			if (file.indexOf('\uFEFF') === 0) {
				file = file.substring(1);
			}
			callback(file);
		};
	} else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
		text.get = function (url, callback, errback) {
			var xhr = text.createXhr();
			xhr.open('GET', url, true);

			//Allow overrides specified in config
			if (masterConfig.onXhr) {
				masterConfig.onXhr(xhr, url);
			}

			xhr.onreadystatechange = function (evt) {
				var status, err;
				//Do not explicitly handle errors, those should be
				//visible via console output in the browser.
				if (xhr.readyState === 4) {
					status = xhr.status;
					if (status > 399 && status < 600) {
						//An http 4xx or 5xx error. Signal an error.
						err = new Error(url + ' HTTP status: ' + status);
						err.xhr = xhr;
						errback(err);
					} else {
						callback(xhr.responseText);
					}
				}
			};
			xhr.send(null);
		};
	} else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
		//Why Java, why is this so awkward?
		text.get = function (url, callback) {
			var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
			try {
				stringBuffer = new java.lang.StringBuffer();
				line = input.readLine();

				// Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
				// http://www.unicode.org/faq/utf_bom.html

				// Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
				// http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
				if (line && line.length() && line.charAt(0) === 0xfeff) {
					// Eat the BOM, since we've already found the encoding on this file,
					// and we plan to concatenating this buffer with others; the BOM should
					// only appear at the top of a file.
					line = line.substring(1);
				}

				stringBuffer.append(line);

				while ((line = input.readLine()) !== null) {
					stringBuffer.append(lineSeparator);
					stringBuffer.append(line);
				}
				//Make sure we return a JavaScript string and not a Java string.
				content = String(stringBuffer.toString()); //String
			} finally {
				input.close();
			}
			callback(content);
		};
	}

	String.prototype.regexIndexOf = function (regex, startpos) {
		var indexOf = this.substring(startpos || 0).search(regex);
		return (indexOf >= 0) ? (indexOf + (startpos || 0)) : indexOf;
	}

	String.prototype.regexLastIndexOf = function (regex, startpos) {
		regex = (regex.global) ? regex : new RegExp(regex.source, "g" + (regex.ignoreCase ? "i" : "") + (regex.multiLine ? "m" : ""));
		if (typeof (startpos) == "undefined") {
			startpos = this.length;
		} else if (startpos < 0) {
			startpos = 0;
		}
		var stringToWorkWith = this.substring(0, startpos + 1);
		var lastIndexOf = -1;
		var nextStop = 0;
		while ((result = regex.exec(stringToWorkWith)) != null) {
			lastIndexOf = result.index;
			regex.lastIndex = ++nextStop;
			regex.result = result;
		}
		return lastIndexOf;
	}


	return text;

	function replaceRegEx_r_js(content, regex, regexStringArgs, moduleFile, quote) {
		//console.log("WA3 file: ", moduleFile);
		//return content;
		//console.log("\n\n\n0 content: " + content);
		content = content.replace(regex, function (match, nestingLevel, method, stringArgs, index) {
			//console.log("arguments: ", arguments);
			//console.log("index: ", index);
			var args = [];
			var argType = [];
			//if (!quote) {
			var returnRegEx = /define\(.*?,\s*\[\],\s*function\s*\(\)\s*\{\s*return\s*/g;
			var returnPos = content.regexLastIndexOf(returnRegEx, index);
			if (returnRegEx.result && returnRegEx.result.length) {
				returnPos += returnRegEx.result[0].length;
			}
			//console.log("returnPos", index, moduleFile, content.substr(returnPos, 20));
			if (returnPos + 1) {
				quote = "";
				var ch, stop = 3;
				do {
					ch = content.charAt(returnPos++);
					quote += ch;
				}
				while (ch != "'" && ch != '"' && --stop);
				//console.log("returnRegEx.result[0]", ch, returnRegEx.result[0]);

				if (!stop) return match;//we don't seem to be in a string
			}
			else {
				//console.log("quote not found", quote, match);
			}
			//console.log("1 match: " + match + " nestingLevel: " + nestingLevel + " method: " + method + " stringArgs: " + stringArgs);
			if (/(~\![*0-9])/.test(match)) {
				stringArgs = replaceRegEx_r_js(stringArgs, regex, regexStringArgs, moduleFile, quote);
			}
			stringArgs && stringArgs.replace(regexStringArgs, function (match, expr, string, nonString) {
				//console.log("2 match: " + match + " expr: " + expr + " string: " + string + " nonString: " + nonString);
				if (string) {
					args.push(string);
					argType.push('string');
				} else {
					args.push(nonString);
					argType.push('nonstring');
				}
			});
			if (args.length > 0) {

				args.forEach(function (value, index, array) {
					var isString = argType[index] == 'string' || typeof value == 'undefined';
					value = (value ? value.toString() : '');
					array[index] = value.indexOf("_") === 0 || !isString ? value : quote + value + quote;
				});
				//console.log("\n\n\n",content);
				return (nestingLevel == '*' ? quote + '+' : '') + method + '(' + args.join(',') + ')' + (nestingLevel == '*' ? '+' + quote : '');
			}
		});
		//console.log("3 content: ", content);

		return content
			.replace(/!#2C;/g, ',') //decode commas (,)
			.replace(/!#126;/g, '~'); //decode tilda chars (~)
	};
});

/** @license
 * RequireJS plugin for loading JSON files
 * - depends on Text plugin and it was HEAVILY "inspired" by it as well.
 * Author: Miller Medeiros
 * Version: 0.3.1 (2013/02/04)
 * Released under the MIT license
 */
define('json', [
	'text'
], function (text) {

	var CACHE_BUST_QUERY_PARAM = 'bust',
        CACHE_BUST_FLAG = '!bust',
        jsonParse = (typeof JSON !== 'undefined' && typeof JSON.parse === 'function') ? JSON.parse : function (val) {
        	return eval('(' + val + ')'); //quick and dirty
        },
        buildMap = {};

	function cacheBust(url) {
		url = url.replace(CACHE_BUST_FLAG, '');
		url += (url.indexOf('?') < 0) ? '?' : '&';
		return url + CACHE_BUST_QUERY_PARAM + '=' + Math.round(2147483647 * Math.random());
	}

	//API
	return {

		load: function (name, req, onLoad, config) {
			if (config.isBuild && (config.inlineJSON === false || name.indexOf(CACHE_BUST_QUERY_PARAM + '=') !== -1)) {
				//avoid inlining cache busted JSON or if inlineJSON:false
				onLoad(null);
			} else {
				text.get(req.toUrl(name), function (data) {
					if (config.isBuild) {
						buildMap[name] = data;
						onLoad(data);
					} else {
						onLoad(jsonParse(data));
					}
				},
                    onLoad.error, {
                    	accept: 'application/json'
                    }
                );
			}
		},

		normalize: function (name, normalize) {
			//used normalize to avoid caching references to a "cache busted" request
			return (name.indexOf(CACHE_BUST_FLAG) === -1) ? name : cacheBust(name);
		},

		//write method based on RequireJS official text plugin by James Burke
		//https://github.com/jrburke/requirejs/blob/master/text.js
		write: function (pluginName, moduleName, write) {
			if (moduleName in buildMap) {
				var content = buildMap[moduleName];
				write("define('" + pluginName + '!' + moduleName + "', [], function(){ return " + content + ";});\n");
			}
		}

	};
});

/**	`css` is a requirejs plugin
	that loads a css file and inject it into a page.
	note that this loader will return immediately,
	regardless of whether the browser had finished parsing the stylesheet.
	this css loader is implemented for file optimization and depedency managment
 */

define("css", {
	load: function (name, require, load, config) {
		function inject(filename)
		{
			var head = document.getElementsByTagName('head')[0];
			var link = document.createElement('link');
			link.href = filename;
			link.rel = 'stylesheet';
			link.type = 'text/css';
			!window.QUnit && head.appendChild(link);
		}
		inject(requirejs.toUrl(name));
		load(true);
	},
	pluginBuilder: 'vendor/requirejs/plugins/css-build'
});

define('jquery', [
], function () {
	return window.jQuery;
});
/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The entrance transition module.
 * @module entrance
 * @requires system
 * @requires composition
 * @requires jquery
 */
define('durandal/transitions/entrance', ['durandal/system', 'durandal/composition', 'jquery'], function (system, composition, $) {
	var fadeOutDuration = 100;
	var endValues = {
		marginRight: 0,
		marginLeft: 0,
		opacity: 1,
	};
	var clearValues = {
		//marginLeft: '',
		//marginRight: '',
		//opacity: '',
		//display: '',
		'-webkit-transition': '',
		'-moz-transition': '',
		'-o-transition': '',
		'transition': '',
	};

	/**
     * @class EntranceModule
     * @constructor
     */
	var entrance = function (context) {
		fadeOutDuration = context.fadeOutDuration || fadeOutDuration;
		return system.defer(function (dfd) {

			function endTransition() {
				context.animateClass && $(document.body).removeClass(context.animateClass);
				dfd.resolve();
				$.isFunction(context.transitionComplete) && context.transitionComplete.call(this, context);
			}

			function scrollIfNeeded() {
				if (!context.keepScrollPosition) {
					$(document).scrollTop(0);
				}
			}


			if (!context.child) {
				$(context.activeView).fadeOut(fadeOutDuration, endTransition);
			} else {
				var duration = context.duration || 500;
				var fadeOnly = !!context.fadeOnly;

				function startTransition() {
					scrollIfNeeded();
					context.triggerAttach();
					context.animateClass && $(document.body).addClass(context.animateClass);
					var startValues = {
						marginLeft: fadeOnly ? '0' : '20px',
						marginRight: fadeOnly ? '0' : '-20px',
						opacity: 1,
						display: 'block',
					};

					var $child = $(context.child);

					function done() {
						$child.off("transitionend webkitTransitionEnd oTransitionEnd MSTransitionEnd", done);

						$child.css(clearValues);
						endTransition();
						//endTransition.defer(100);
					}

					$child.css(startValues);
					//endTransition();

					if (Modernizr.csstransitions) {
						var transition = 'all ' + (duration / 1000) + 's cubic-bezier(.02, .01, .47, 1)';
						//alert(transition);
						//transition = 'all 10s ease-in-out';
						$child.css({
							'-webkit-transition': transition,
							'-moz-transition': transition,
							'-o-transition': transition,
							'transition': transition,
						});

						!function () {
							$child.on("transitionend webkitTransitionEnd oTransitionEnd MSTransitionEnd", done);
							$child.css(endValues);
						}.defer(0);
					}
					else {
						$child.animate(endValues, duration, 'swing', done);
					}
				}

				if (context.activeView) {
					$(context.activeView).fadeOut(fadeOutDuration, startTransition);
				} else {
					startTransition();
				}
			}
		}).promise();
	};

	return entrance;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The system module encapsulates the most basic features used by other modules.
 * @module system
 * @requires require
 * @requires jquery
 */
define('durandal/system', ['jquery'], function($) {
	var isDebugging = false,
        nativeKeys = Object.keys,
        hasOwnProperty = Object.prototype.hasOwnProperty,
        toString = Object.prototype.toString,
        system,
        treatAsIE8 = false,
        nativeIsArray = Array.isArray,
        slice = Array.prototype.slice;

    //see http://patik.com/blog/complete-cross-browser-console-log/
    // Tell IE9 to use its built-in console
    if (Function.prototype.bind && (typeof console === 'object' || typeof console === 'function') && typeof console.log == 'object') {
        try {
            ['log', 'info', 'warn', 'error', 'assert', 'dir', 'clear', 'profile', 'profileEnd']
                .forEach(function(method) {
                    console[method] = this.call(console[method], console);
                }, Function.prototype.bind);
        } catch (ex) {
            treatAsIE8 = true;
        }
    }

    // callback for dojo's loader 
    // note: if you wish to use Durandal with dojo's AMD loader,
    // currently you must fork the dojo source with the following
    // dojo/dojo.js, line 1187, the last line of the finishExec() function: 
    //  (add) signal("moduleLoaded", [module.result, module.mid]);
    // an enhancement request has been submitted to dojo to make this
    // a permanent change. To view the status of this request, visit:
    // http://bugs.dojotoolkit.org/ticket/16727

    if (require.on) {
        require.on("moduleLoaded", function(module, mid) {
            system.setModuleId(module, mid);
        });
    }

    // callback for require.js loader
    if (typeof requirejs !== 'undefined') {
        requirejs.onResourceLoad = function(context, map, depArray) {
            system.setModuleId(context.defined[map.id], map.id);
        };
    }

    var noop = function() { };

    var log = function() {
        try {
            // Modern browsers
            if (typeof console != 'undefined' && typeof console.log == 'function') {
                // Opera 11
                if (window.opera) {
                    var i = 0;
                    while (i < arguments.length) {
                        console.log('Item ' + (i + 1) + ': ' + arguments[i]);
                        i++;
                    }
                }
                // All other modern browsers
                else if ((slice.call(arguments)).length == 1 && typeof slice.call(arguments)[0] == 'string') {
                    console.log((slice.call(arguments)).toString());
                } else {
                    console.log.apply(console, slice.call(arguments));
                }
            }
            // IE8
            else if ((!Function.prototype.bind || treatAsIE8) && typeof console != 'undefined' && typeof console.log == 'object') {
                Function.prototype.call.call(console.log, console, slice.call(arguments));
            }

            // IE7 and lower, and other old browsers
        } catch (ignore) { }
    };

    var logError = function(error) {
        if(error instanceof Error){
            throw error;
        }

        throw new Error(error);
    };

    /**
     * @class SystemModule
     * @static
     */
    system = {
        /**
         * Durandal's version.
         * @property {string} version
         */
        version: "2.0.0",
        /**
         * A noop function.
         * @method noop
         */
        noop: noop,
        /**
         * Gets the module id for the specified object.
         * @method getModuleId
         * @param {object} obj The object whose module id you wish to determine.
         * @return {string} The module id.
         */
        getModuleId: function(obj) {
            if (!obj) {
                return null;
            }

            if (typeof obj == 'function') {
                return obj.prototype.__moduleId__;
            }

            if (typeof obj == 'string') {
                return null;
            }

            return obj.__moduleId__;
        },
        /**
         * Sets the module id for the specified object.
         * @method setModuleId
         * @param {object} obj The object whose module id you wish to set.
         * @param {string} id The id to set for the specified object.
         */
        setModuleId: function(obj, id) {
            if (!obj) {
                return;
            }

            if (typeof obj == 'function') {
                obj.prototype.__moduleId__ = id;
                return;
            }

            if (typeof obj == 'string') {
                return;
            }

            obj.__moduleId__ = id;
        },
        /**
         * Resolves the default object instance for a module. If the module is an object, the module is returned. If the module is a function, that function is called with `new` and it's result is returned.
         * @method resolveObject
         * @param {object} module The module to use to get/create the default object for.
         * @return {object} The default object for the module.
         */
        resolveObject: function(module) {
            if (system.isFunction(module)) {
                return new module();
            } else {
                return module;
            }
        },
        /**
         * Gets/Sets whether or not Durandal is in debug mode.
         * @method debug
         * @param {boolean} [enable] Turns on/off debugging.
         * @return {boolean} Whether or not Durandal is current debugging.
         */
        debug: function(enable) {
            if (arguments.length == 1) {
                isDebugging = enable;
                if (isDebugging) {
                	this.log = window.console && console.log.bind ? console.log.bind(console) : log;
                    this.error = logError;
                    //this.log('Debug:Enabled');
                } else {
                    //this.log('Debug:Disabled');
                    this.log = noop;
                    this.error = noop;
                }
            }

            return isDebugging;
        },
        /**
         * Logs data to the console. Pass any number of parameters to be logged. Log output is not processed if the framework is not running in debug mode.
         * @method log
         * @param {object} info* The objects to log.
         */
        log: noop,
        /**
         * Logs an error.
         * @method error
         * @param {string|Error} obj The error to report.
         */
        error: function (error) {
        	try{
        		elmah(error);
        	} catch (e) {
        		if (window.appConfig
					&& appConfig.url) {
        			var url = appConfig.url + '/en/Home/RecordClientError';
        			$.ajax({
        				url: appConfig.url,
        				type: "post",
        				data: {
        					error: JSON.stringify({ elmahError: e, initialError: error }),
        				}
        			});
        		}
        	}
        },
        /**
         * Asserts a condition by throwing an error if the condition fails.
         * @method assert
         * @param {boolean} condition The condition to check.
         * @param {string} message The message to report in the error if the condition check fails.
         */
        assert: function (condition, message) {
            if (!condition) {
                system.error(new Error(message || 'Assert:Failed'));
            }
        },
        /**
         * Creates a deferred object which can be used to create a promise. Optionally pass a function action to perform which will be passed an object used in resolving the promise.
         * @method defer
         * @param {function} [action] The action to defer. You will be passed the deferred object as a paramter.
         * @return {Deferred} The deferred object.
         */
        defer: function(action) {
            return $.Deferred(action);
        },
        /**
         * Creates a simple V4 UUID. This should not be used as a PK in your database. It can be used to generate internal, unique ids. For a more robust solution see [node-uuid](https://github.com/broofa/node-uuid).
         * @method guid
         * @return {string} The guid.
         */
        guid: function() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },
        /**
         * Uses require.js to obtain a module. This function returns a promise which resolves with the module instance. You can pass more than one module id to this function or an array of ids. If more than one or an array is passed, then the promise will resolve with an array of module instances.
         * @method acquire
         * @param {string|string[]} moduleId The id(s) of the modules to load.
         * @return {Promise} A promise for the loaded module(s).
         */
        acquire: function() {
            var modules,
                first = arguments[0],
                arrayRequest = false;

            if(system.isArray(first)){
                modules = first;
                arrayRequest = true;
            }else{
                modules = slice.call(arguments, 0);
            }

            return this.defer(function(dfd) {
                require(modules, function() {
                    var args = arguments;
                    setTimeout(function() {
                        if(args.length > 1 || arrayRequest){
                            dfd.resolve(slice.call(args, 0));
                        }else{
                            dfd.resolve(args[0]);
                        }
                    }, 1);
                }, function(err){
                	if (isDebugging)
                		throw err;
                	dfd.reject(err);
                });
            }).promise();
        },
        /**
         * Extends the first object with the properties of the following objects.
         * @method extend
         * @param {object} obj The target object to extend.
         * @param {object} extension* Uses to extend the target object.
         */
        extend: function(obj) {
            var rest = slice.call(arguments, 1);

            for (var i = 0; i < rest.length; i++) {
                var source = rest[i];

                if (source) {
                    for (var prop in source) {
                        obj[prop] = source[prop];
                    }
                }
            }

            return obj;
        },
        /**
         * Uses a setTimeout to wait the specified milliseconds.
         * @method wait
         * @param {number} milliseconds The number of milliseconds to wait.
         * @return {Promise}
         */
        wait: function(milliseconds) {
            return system.defer(function(dfd) {
                setTimeout(dfd.resolve, milliseconds);
            }).promise();
        }
    };

    /**
     * Gets all the owned keys of the specified object.
     * @method keys
     * @param {object} object The object whose owned keys should be returned.
     * @return {string[]} The keys.
     */
    system.keys = nativeKeys || function(obj) {
        if (obj !== Object(obj)) {
            throw new TypeError('Invalid object');
        }

        var keys = [];

        for (var key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                keys[keys.length] = key;
            }
        }

        return keys;
    };

    /**
     * Determines if the specified object is an html element.
     * @method isElement
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */
    system.isElement = function(obj) {
        return !!(obj && obj.nodeType === 1);
    };

    /**
     * Determines if the specified object is an array.
     * @method isArray
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */
    system.isArray = nativeIsArray || function(obj) {
        return toString.call(obj) == '[object Array]';
    };

    /**
     * Determines if the specified object is...an object. ie. Not an array, string, etc.
     * @method isObject
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */
    system.isObject = function(obj) {
        return obj === Object(obj);
    };

    /**
     * Determines if the specified object is a boolean.
     * @method isBoolean
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */
    system.isBoolean = function(obj) {
        return typeof(obj) === "boolean";
    };

    /**
     * Determines if the specified object is a promise.
     * @method isPromise
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */
    system.isPromise = function(obj) {
        return obj && system.isFunction(obj.then);
    };

    /**
     * Determines if the specified object is a function arguments object.
     * @method isArguments
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    /**
     * Determines if the specified object is a function.
     * @method isFunction
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    /**
     * Determines if the specified object is a string.
     * @method isString
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    /**
     * Determines if the specified object is a number.
     * @method isNumber
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    /**
     * Determines if the specified object is a date.
     * @method isDate
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    /**
     * Determines if the specified object is a boolean.
     * @method isBoolean
     * @param {object} object The object to check.
     * @return {boolean} True if matches the type, false otherwise.
     */

    //isArguments, isFunction, isString, isNumber, isDate, isRegExp.
    var isChecks = ['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'];

    function makeIsFunction(name) {
        var value = '[object ' + name + ']';
        system['is' + name] = function(obj) {
            return toString.call(obj) == value;
        };
    }

    for (var i = 0; i < isChecks.length; i++) {
        makeIsFunction(isChecks[i]);
    }

    return system;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The binder joins an object instance and a DOM element tree by applying databinding and/or invoking binding lifecycle callbacks (binding and bindingComplete).
 * @module binder
 * @requires system
 * @requires knockout
 */
define('durandal/binder', ['durandal/system', 'knockout'], function (system, ko) {
    var binder,
        insufficientInfoMessage = 'Insufficient Information to Bind',
        unexpectedViewMessage = 'Unexpected View Type',
        bindingInstructionKey = 'durandal-binding-instruction',
        koBindingContextKey = '__ko_bindingContext__';

    function normalizeBindingInstruction(result){
        if(result === undefined){
            return { applyBindings: true };
        }

        if(system.isBoolean(result)){
            return { applyBindings:result };
        }

        if(result.applyBindings === undefined){
            result.applyBindings = true;
        }

        return result;
    }

    function doBind(obj, view, bindingTarget, data){
        if (!view || !bindingTarget) {
            if (binder.throwOnErrors) {
                system.error(insufficientInfoMessage);
            } else {
                system.log(insufficientInfoMessage, view, data);
            }
            return;
        }

        if (!view.getAttribute) {
            if (binder.throwOnErrors) {
                system.error(unexpectedViewMessage);
            } else {
                system.log(unexpectedViewMessage, view, data);
            }
            return;
        }

        var viewName = view.getAttribute('data-view');
        function executeBind() {
        	var instruction;

        	if (obj && obj.binding) {
        		instruction = obj.binding(view);
        	}

        	instruction = normalizeBindingInstruction(instruction);
        	binder.binding(data, view, instruction);

        	if (instruction.applyBindings) {
        		system.log('Binding', viewName, data);
        		ko.applyBindings(bindingTarget, view);
        	} else if (obj) {
        		ko.utils.domData.set(view, koBindingContextKey, { $data: obj });
        	}

        	binder.bindingComplete(data, view, instruction);

        	if (obj && obj.bindingComplete) {
        		obj.bindingComplete(view);
        	}

        	ko.utils.domData.set(view, bindingInstructionKey, instruction);
        	return instruction;
        }
        if (system.debug())
        	return executeBind();
		else try {
        	return executeBind();
        } catch (e) {
			e.message = e.message + ';\nView: ' + viewName + ";\nModuleId: " + system.getModuleId(data) + "\n\n";
			if (e.details) {
				var d = [];
				composeExceptionMessage(e, d);
				function composeExceptionMessage(e, d) {
					if (e.details) {
						e.details.forEach(function (details) {
							if (!d.length || details.ex != e) {
								d.push(details.ex && details.ex.message);
							}
							d.push("  Bind:", details.bindingKey + ": ", details.bindingValue, "\n   Node:", details.node, "\nContext:", details.context, "\n\n");
							if (e !== details.ex && details.ex && details.ex.details) {
								composeExceptionMessage(details.ex, d);
							}
						});
					} else {
						d.push(e);
					}
				}
				if (navigator.appName == 'Microsoft Internet Explorer') {
					d.forEach(function (err, i) {
						if (typeof (err) in { 'object': '', 'function': '' }) {
							if (err && err.outerHTML) {
								console.log(err.outerHTML.substr(0, 200));
							} else if (err && err.nodeValue) {
								console.log(err.nodeValue.substr(0, 200));
							} else {
								console.dir(err);
							}
						} else {
							console[i ? 'log' : 'error'](err);
						}
					});
				} else {
					console.error && console.error.apply(console, d);
				}
			}
            if (binder.throwOnErrors) {
                system.error(e);
            } else {
                system.log(e.message);
            }
        }
    }

    /**
     * @class BinderModule
     * @static
     */
    return binder = {
        /**
         * Called before every binding operation. Does nothing by default.
         * @method binding
         * @param {object} data The data that is about to be bound.
         * @param {DOMElement} view The view that is about to be bound.
         * @param {object} instruction The object that carries the binding instructions.
         */
        binding: system.noop,
        /**
         * Called after every binding operation. Does nothing by default.
         * @method bindingComplete
         * @param {object} data The data that has just been bound.
         * @param {DOMElement} view The view that has just been bound.
         * @param {object} instruction The object that carries the binding instructions.
         */
        bindingComplete: system.noop,
        /**
         * Indicates whether or not the binding system should throw errors or not.
         * @property {boolean} throwOnErrors
         * @default false The binding system will not throw errors by default. Instead it will log them.
         */
        throwOnErrors: false,
        /**
         * Gets the binding instruction that was associated with a view when it was bound.
         * @method getBindingInstruction
         * @param {DOMElement} view The view that was previously bound.
         * @return {object} The object that carries the binding instructions.
         */
        getBindingInstruction:function(view){
            return ko.utils.domData.get(view, bindingInstructionKey);
        },
        /**
         * Binds the view, preserving the existing binding context. Optionally, a new context can be created, parented to the previous context.
         * @method bindContext
         * @param {KnockoutBindingContext} bindingContext The current binding context.
         * @param {DOMElement} view The view to bind.
         * @param {object} [obj] The data to bind to, causing the creation of a child binding context if present.
         */
        bindContext: function(bindingContext, view, obj) {
            if (obj && bindingContext) {
                bindingContext = bindingContext.createChildContext(obj);
            }

            return doBind(obj, view, bindingContext, obj || (bindingContext ? bindingContext.$data : null));
        },
        /**
         * Binds the view, preserving the existing binding context. Optionally, a new context can be created, parented to the previous context.
         * @method bind
         * @param {object} obj The data to bind to.
         * @param {DOMElement} view The view to bind.
         */
        bind: function(obj, view) {
            return doBind(obj, view, obj, obj);
        }
    };
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The viewEngine module provides information to the viewLocator module which is used to locate the view's source file. The viewEngine also transforms a view id into a view instance.
 * @module viewEngine
 * @requires system
 * @requires jquery
 */
define('durandal/viewEngine', ['durandal/system', 'jquery', 'durandal/binder'], function (system, $, binder) {
    var parseMarkup;
	
    if ($.parseHTML) {
        parseMarkup = function (html) {
            return $.parseHTML(html);
        };
    } else {
        parseMarkup = function (html) {
            return $(html).get();
        };
    }

    /**
     * @class ViewEngineModule
     * @static
     */
    return {
        /**
         * The file extension that view source files are expected to have.
         * @property {string} viewExtension
         * @default .html
         */
        viewExtension: '.html',
        /**
         * The name of the RequireJS loader plugin used by the viewLocator to obtain the view source. (Use requirejs to map the plugin's full path).
         * @property {string} viewPlugin
         * @default text
         */
        viewPlugin: 'text',
        /**
         * Determines if the url is a url for a view, according to the view engine.
         * @method isViewUrl
         * @param {string} url The potential view url.
         * @return {boolean} True if the url is a view url, false otherwise.
         */
        isViewUrl: function (url) {
            return url.indexOf(this.viewExtension, url.length - this.viewExtension.length) !== -1;
        },
        /**
         * Converts a view url into a view id.
         * @method convertViewUrlToViewId
         * @param {string} url The url to convert.
         * @return {string} The view id.
         */
        convertViewUrlToViewId: function (url) {
            return url.substring(0, url.length - this.viewExtension.length);
        },
        /**
         * Converts a view id into a full RequireJS path.
         * @method convertViewIdToRequirePath
         * @param {string} viewId The view id to convert.
         * @return {string} The require path.
         */
        convertViewIdToRequirePath: function (viewId) {
            return this.viewPlugin + '!' + viewId + this.viewExtension;
        },
        /**
         * Parses the view engine recognized markup and returns DOM elements.
         * @method parseMarkup
         * @param {string} markup The markup to parse.
         * @return {DOMElement[]} The elements.
         */
        parseMarkup: parseMarkup,
        /**
         * Calls `parseMarkup` and then pipes the results through `ensureSingleElement`.
         * @method processMarkup
         * @param {string} markup The markup to process.
         * @return {DOMElement} The view.
         */
        processMarkup: function (markup) {
            var allElements = this.parseMarkup(markup);
            return this.ensureSingleElement(allElements);
        },
        /**
         * Converts an array of elements into a single element. White space and comments are removed. If a single element does not remain, then the elements are wrapped.
         * @method ensureSingleElement
         * @param {DOMElement[]} allElements The elements.
         * @return {DOMElement} A single element.
         */
        ensureSingleElement:function(allElements){
            if (allElements.length == 1) {
                return allElements[0];
            }

            var withoutCommentsOrEmptyText = [];

            for (var i = 0; i < allElements.length; i++) {
                var current = allElements[i];
                if (current.nodeType != 8) {
                    if (current.nodeType == 3) {
                        var result = /\S/.test(current.nodeValue);
                        if (!result) {
                            continue;
                        }
                    }

                    withoutCommentsOrEmptyText.push(current);
                }
            }

            if (withoutCommentsOrEmptyText.length > 1) {
                return $(withoutCommentsOrEmptyText).wrapAll('<div class="durandal-wrapper"></div>').parent().get(0);
            }

            return withoutCommentsOrEmptyText[0];
        },
        /**
         * Creates the view associated with the view id.
         * @method createView
         * @param {string} viewId The view id whose view should be created.
         * @return {Promise} A promise of the view.
         */
        createView: function(viewId) {
            var that = this;
            var requirePath = this.convertViewIdToRequirePath(viewId);

            return system.defer(function(dfd) {
                system.acquire(requirePath).then(function(markup) {
                    var element = that.processMarkup(markup);
                    element.setAttribute('data-view', viewId);
                    dfd.resolve(element);
                }).fail(function(err){
                        that.createFallbackView(viewId, requirePath, err).then(function(element){
                            element.setAttribute('data-view', viewId);
                            dfd.resolve(element);
                        });
                    });
            }).promise();
        },
        /**
         * Called when a view cannot be found to provide the opportunity to locate or generate a fallback view. Mainly used to ease development.
         * @method createFallbackView
         * @param {string} viewId The view id whose view should be created.
         * @param {string} requirePath The require path that was attempted.
         * @param {Error} requirePath The error that was returned from the attempt to locate the default view.
         * @return {Promise} A promise for the fallback view.
         */
        createFallbackView: function (viewId, requirePath, err) {
            var that = this,
                message = 'View Not Found. Searched for "' + viewId + '" via path "' + requirePath + '".';
            if (binder.throwOnErrors)
            	system.error(message);

            return system.defer(function(dfd) {
                dfd.resolve(that.processMarkup('<div class="durandal-view-404">' + message + '</div>'));
            }).promise();
        }
    };
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The viewLocator module collaborates with the viewEngine module to provide views (literally dom sub-trees) to other parts of the framework as needed. The primary consumer of the viewLocator is the composition module.
 * @module viewLocator
 * @requires system
 * @requires viewEngine
 */
define('durandal/viewLocator', ['durandal/system', 'durandal/viewEngine'], function (system, viewEngine) {
    function findInElements(nodes, url) {
        for (var i = 0; i < nodes.length; i++) {
            var current = nodes[i];
            var existingUrl = current.getAttribute('data-view');
            if (existingUrl == url) {
                return current;
            }
        }
    }
    
    function escape(str) {
        return (str + '').replace(/([\\\.\+\*\?\[\^\]\$\(\)\{\}\=\!\<\>\|\:])/g, "\\$1");
    }

    /**
     * @class ViewLocatorModule
     * @static
     */
    return {
        /**
         * Allows you to set up a convention for mapping module folders to view folders. It is a convenience method that customizes `convertModuleIdToViewId` and `translateViewIdToArea` under the covers.
         * @method useConvention
         * @param {string} [modulesPath] A string to match in the path and replace with the viewsPath. If not specified, the match is 'viewmodels'.
         * @param {string} [viewsPath] The replacement for the modulesPath. If not specified, the replacement is 'views'.
         * @param {string} [areasPath] Partial views are mapped to the "views" folder if not specified. Use this parameter to change their location.
         */
        useConvention: function(modulesPath, viewsPath, areasPath) {
            modulesPath = modulesPath || 'viewmodels';
            viewsPath = viewsPath || 'views';
            areasPath = areasPath || viewsPath;

            var reg = new RegExp(escape(modulesPath), 'gi');

            this.convertModuleIdToViewId = function (moduleId) {
                return moduleId.replace(reg, viewsPath);
            };

            this.translateViewIdToArea = function (viewId, area) {
                if (!area || area == 'partial') {
                    return areasPath + '/' + viewId;
                }
                
                return areasPath + '/' + area + '/' + viewId;
            };
        },
        /**
         * Maps an object instance to a view instance.
         * @method locateViewForObject
         * @param {object} obj The object to locate the view for.
         * @param {string} [area] The area to translate the view to.
         * @param {DOMElement[]} [elementsToSearch] An existing set of elements to search first.
         * @return {Promise} A promise of the view.
         */
        locateViewForObject: function(obj, area, elementsToSearch) {
            var view;

            if (obj.getView) {
                view = obj.getView();
                if (view) {
                    return this.locateView(view, area, elementsToSearch);
                }
            }

            if (obj.viewUrl) {
                return this.locateView(obj.viewUrl, area, elementsToSearch);
            }

            var id = system.getModuleId(obj);
            if (id) {
                return this.locateView(this.convertModuleIdToViewId(id), area, elementsToSearch);
            }

            return this.locateView(this.determineFallbackViewId(obj), area, elementsToSearch);
        },
        /**
         * Converts a module id into a view id. By default the ids are the same.
         * @method convertModuleIdToViewId
         * @param {string} moduleId The module id.
         * @return {string} The view id.
         */
        convertModuleIdToViewId: function(moduleId) {
            return moduleId;
        },
        /**
         * If no view id can be determined, this function is called to genreate one. By default it attempts to determine the object's type and use that.
         * @method determineFallbackViewId
         * @param {object} obj The object to determine the fallback id for.
         * @return {string} The view id.
         */
        determineFallbackViewId: function (obj) {
            var funcNameRegex = /function (.{1,})\(/;
            var results = (funcNameRegex).exec((obj).constructor.toString());
            var typeName = (results && results.length > 1) ? results[1] : "";

            return 'views/' + typeName;
        },
        /**
         * Takes a view id and translates it into a particular area. By default, no translation occurs.
         * @method translateViewIdToArea
         * @param {string} viewId The view id.
         * @param {string} area The area to translate the view to.
         * @return {string} The translated view id.
         */
        translateViewIdToArea: function (viewId, area) {
            return viewId;
        },
        /**
         * Locates the specified view.
         * @method locateView
         * @param {string|DOMElement} viewOrUrlOrId A view, view url or view id to locate.
         * @param {string} [area] The area to translate the view to.
         * @param {DOMElement[]} [elementsToSearch] An existing set of elements to search first.
         * @return {Promise} A promise of the view.
         */
        locateView: function(viewOrUrlOrId, area, elementsToSearch) {
            if (typeof viewOrUrlOrId === 'string') {
                var viewId;

                if (viewEngine.isViewUrl(viewOrUrlOrId)) {
                    viewId = viewEngine.convertViewUrlToViewId(viewOrUrlOrId);
                } else {
                    viewId = viewOrUrlOrId;
                }

                if (area) {
                    viewId = this.translateViewIdToArea(viewId, area);
                }

                if (elementsToSearch) {
                    var existing = findInElements(elementsToSearch, viewId);
                    if (existing) {
                        return system.defer(function(dfd) {
                            dfd.resolve(existing);
                        }).promise();
                    }
                }

                return viewEngine.createView(viewId);
            }

            return system.defer(function(dfd) {
                dfd.resolve(viewOrUrlOrId);
            }).promise();
        }
    };
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The activator module encapsulates all logic related to screen/component activation.
 * An activator is essentially an asynchronous state machine that understands a particular state transition protocol.
 * The protocol ensures that the following series of events always occur: `canDeactivate` (previous state), `canActivate` (new state), `deactivate` (previous state), `activate` (new state).
 * Each of the _can_ callbacks may return a boolean, affirmative value or promise for one of those. If either of the _can_ functions yields a false result, then activation halts.
 * @module activator
 * @requires system
 * @requires knockout
 */
define('durandal/activator', ['durandal/system', 'knockout'], function (system, ko) {
	var activator, $body = $(document.body), $html = $('html'), shashRegEx = new RegExp("\\/", "g");

	function ensureSettings(settings) {
		if (settings == undefined) {
			settings = {};
		}

		if (!settings.closeOnDeactivate) {
			settings.closeOnDeactivate = activator.defaults.closeOnDeactivate;
		}

		if (!settings.beforeActivate) {
			settings.beforeActivate = activator.defaults.beforeActivate;
		}

		if (!settings.afterDeactivate) {
			settings.afterDeactivate = activator.defaults.afterDeactivate;
		}

		if (!settings.affirmations) {
			settings.affirmations = activator.defaults.affirmations;
		}

		if (!settings.interpretResponse) {
			settings.interpretResponse = activator.defaults.interpretResponse;
		}

		if (!settings.areSameItem) {
			settings.areSameItem = activator.defaults.areSameItem;
		}

		return settings;
	}

	function invoke(target, method, data) {
		if (system.isArray(data)) {
			return target[method].apply(target, data);
		}

		return target[method](data);
	}

	function deactivate(item, close, settings, dfd, setter) {
		if (item && item.deactivate) {
			system.log('Deactivating', item);

			var result;
			if (system.debug())
				result = item.deactivate(close);
			else try {
				result = item.deactivate(close);
			} catch (error) {
				system.error(error);
				dfd.resolve(false);
				return;
			}

			if (result && result.then) {
				result.then(function () {
					settings.afterDeactivate(item, close, setter);
					dfd.resolve(true);
				}, function (reason) {
					system.log(reason);
					dfd.resolve(false);
				});
			} else {
				settings.afterDeactivate(item, close, setter);
				dfd.resolve(true);
			}
		} else {
			if (item) {
				settings.afterDeactivate(item, close, setter);
			}

			dfd.resolve(true);
		}
	}

	function activate(newItem, activeItem, callback, activationData) {
		var active = ko.unwrap(activeItem), moduleId;
		if (active && (moduleId = active.__moduleId__ || '')) {
			$body.removeClass(('m-' + moduleId).replace(shashRegEx, ' m-'));
			$html.removeClass(('h-' + moduleId).replace(shashRegEx, ' h-'));
		}
		if (newItem) {
			if ((moduleId = newItem.__moduleId__ || '')) {
				$body.addClass(('m-' + moduleId).replace(shashRegEx, ' m-'));
				$html.addClass(('h-' + moduleId).replace(shashRegEx, ' h-'));
			}
			if (newItem.activate) {
				system.log('Activating', newItem);

				var result;
				if (system.debug())
					result = invoke(newItem, 'activate', activationData);
				else try {
					result = invoke(newItem, 'activate', activationData);
				} catch (error) {
					console.log("error activating");
					console.error(error);
					system.error(error);
					callback(false);
					return;
				}

				if (result && result.then) {
					result.then(function (data) {
						activeItem(newItem);
						callback(true);
						return data;
					}, function (reason) {
						system.log(reason);
						//console.log("activate failed reason:" + reason);
						callback(false);
					});
				} else {
					activeItem(newItem);
					callback(true);
				}
			} else {
				activeItem(newItem);
				callback(true);
			}
		} else {
			callback(true);
		}
	}

	function canDeactivateItem(item, close, settings) {
		settings.lifecycleData = null;

		return system.defer(function (dfd) {
			if (item && item.canDeactivate) {
				var resultOrPromise;
				try {
					resultOrPromise = item.canDeactivate(close);
					//console.log("resultOrPromise:" + typeof resultOrPromise + ";" + resultOrPromise)
				} catch (error) {
					console.log("Error resultOrPromise:" + typeof resultOrPromise + ";" + resultOrPromise)
					system.error(error);
					dfd.resolve(false);
					return;
				}

				if (resultOrPromise.then) {
					resultOrPromise.then(function (result) {
						settings.lifecycleData = result;
						dfd.resolve(settings.interpretResponse(result));
					}, function (reason) {
						system.error(reason);
						dfd.resolve(false);
					});
				} else {
					settings.lifecycleData = resultOrPromise;
					dfd.resolve(settings.interpretResponse(resultOrPromise));
				}
			} else {
				dfd.resolve(true);
			}
		}).promise();
	};

	function canActivateItem(newItem, activeItem, settings, activationData) {
		settings.lifecycleData = null;

		return system.defer(function (dfd) {
			if (newItem == activeItem()) {
				dfd.resolve(true);
				return;
			}

			if (newItem && newItem.canActivate) {
				var resultOrPromise;
				try {
					resultOrPromise = invoke(newItem, 'canActivate', activationData);
				} catch (error) {
					system.error(error);
					dfd.resolve(false);
					return;
				}

				if (resultOrPromise.then) {
					resultOrPromise.then(function (result) {
						settings.lifecycleData = result;
						dfd.resolve(settings.interpretResponse(result));
					}, function (reason) {
						system.error(reason);
						dfd.resolve(false);
					});
				} else {
					settings.lifecycleData = resultOrPromise;
					dfd.resolve(settings.interpretResponse(resultOrPromise));
				}
			} else {
				dfd.resolve(true);
			}
		}).promise();
	};

	/**
     * An activator is a read/write computed observable that enforces the activation lifecycle whenever changing values.
     * @class Activator
     */
	function createActivator(initialActiveItem, settings) {
		var activeItem = ko.observable(null);
		var activeData;

		settings = ensureSettings(settings);

		var computed = ko.computed({
			read: function () {
				return activeItem();
			},
			write: function (newValue) {
				computed.viaSetter = true;
				computed.activateItem(newValue);
			}
		});

		computed.__activator__ = true;

		/**
         * The settings for this activator.
         * @property {ActivatorSettings} settings
         */
		computed.settings = settings;
		settings.activator = computed;

		/**
         * An observable which indicates whether or not the activator is currently in the process of activating an instance.
         * @method isActivating
         * @return {boolean}
         */
		computed.isActivating = ko.observable(false);

		/**
         * Determines whether or not the specified item can be deactivated.
         * @method canDeactivateItem
         * @param {object} item The item to check.
         * @param {boolean} close Whether or not to check if close is possible.
         * @return {promise}
         */
		computed.canDeactivateItem = function (item, close) {
			return canDeactivateItem(item, close, settings);
		};

		/**
         * Deactivates the specified item.
         * @method deactivateItem
         * @param {object} item The item to deactivate.
         * @param {boolean} close Whether or not to close the item.
         * @return {promise}
         */
		computed.deactivateItem = function (item, close) {
			return system.defer(function (dfd) {
				computed.canDeactivateItem(item, close).then(function (canDeactivate) {
					if (canDeactivate) {
						deactivate(item, close, settings, dfd, activeItem);
					} else {
						computed.notifySubscribers();
						dfd.resolve(false);
					}
				});
			}).promise();
		};

		/**
         * Determines whether or not the specified item can be activated.
         * @method canActivateItem
         * @param {object} item The item to check.
         * @param {object} activationData Data associated with the activation.
         * @return {promise}
         */
		computed.canActivateItem = function (newItem, activationData) {
			return canActivateItem(newItem, activeItem, settings, activationData);
		};

		/**
         * Activates the specified item.
         * @method activateItem
         * @param {object} newItem The item to activate.
         * @param {object} newActivationData Data associated with the activation.
         * @return {promise}
         */
		computed.activateItem = function (newItem, newActivationData) {
			var viaSetter = computed.viaSetter;
			computed.viaSetter = false;

			return system.defer(function (dfd) {
				//console.log("isActivating::"+computed.isActivating());
				if (computed.isActivating()) {
					//console.log("isActivating:false");
					dfd.resolve(false);
					return;
				}

				//console.log("isActivating:true");
				computed.isActivating(true);

				var currentItem = activeItem();
				if (settings.areSameItem(currentItem, newItem, activeData, newActivationData)) {
					computed.isActivating(false);
					dfd.resolve(true);
					return;
				}

				//console.log("canDeactivateItem");
				computed.canDeactivateItem(currentItem, settings.closeOnDeactivate).then(function (canDeactivate) {
					//console.log("canDeactivateItem:" + canDeactivate);
					if (canDeactivate) {
						//console.log("canActivateItem");
						computed.canActivateItem(newItem, newActivationData).then(function (canActivate) {
							//console.log("canActivate:" + canActivate);
							if (canActivate) {
								system.defer(function (dfd2) {
									deactivate(currentItem, settings.closeOnDeactivate, settings, dfd2);
								}).promise().then(function () {
									newItem = settings.beforeActivate(newItem, newActivationData);
									//console.log("activate");
									activate(newItem, activeItem, function (result) {
										//console.log("activate:"+typeof result+":"+result);
										activeData = newActivationData;
										computed.isActivating(false);
										dfd.resolve(result);
									}, newActivationData);
								});
							} else {
								if (viaSetter) {
									computed.notifySubscribers();
								}
								console.log("dfd canActivate: resolved to false");

								computed.isActivating(false);
								dfd.resolve(false);
							}
						});
					} else {
						if (viaSetter) {
							computed.notifySubscribers();
						}

						console.log("dfd canDeactivate: resolved to false");
						computed.isActivating(false);
						dfd.resolve(false);
					}
				});
			}).promise();
		};

		/**
         * Determines whether or not the activator, in its current state, can be activated.
         * @method canActivate
         * @return {promise}
         */
		computed.canActivate = function () {
			var toCheck;

			if (initialActiveItem) {
				toCheck = initialActiveItem;
				initialActiveItem = false;
			} else {
				toCheck = computed();
			}

			return computed.canActivateItem(toCheck);
		};

		/**
         * Activates the activator, in its current state.
         * @method activate
         * @return {promise}
         */
		computed.activate = function () {
			var toActivate;

			if (initialActiveItem) {
				toActivate = initialActiveItem;
				initialActiveItem = false;
			} else {
				toActivate = computed();
			}

			return computed.activateItem(toActivate);
		};

		/**
         * Determines whether or not the activator, in its current state, can be deactivated.
         * @method canDeactivate
         * @return {promise}
         */
		computed.canDeactivate = function (close) {
			return computed.canDeactivateItem(computed(), close);
		};

		/**
         * Deactivates the activator, in its current state.
         * @method deactivate
         * @return {promise}
         */
		computed.deactivate = function (close) {
			return computed.deactivateItem(computed(), close);
		};

		computed.includeIn = function (includeIn) {
			includeIn.canActivate = function () {
				return computed.canActivate();
			};

			includeIn.activate = function () {
				return computed.activate();
			};

			includeIn.canDeactivate = function (close) {
				return computed.canDeactivate(close);
			};

			includeIn.deactivate = function (close) {
				return computed.deactivate(close);
			};
		};

		if (settings.includeIn) {
			computed.includeIn(settings.includeIn);
		} else if (initialActiveItem) {
			computed.activate();
		}

		computed.forItems = function (items) {
			settings.closeOnDeactivate = false;

			settings.determineNextItemToActivate = function (list, lastIndex) {
				var toRemoveAt = lastIndex - 1;

				if (toRemoveAt == -1 && list.length > 1) {
					return list[1];
				}

				if (toRemoveAt > -1 && toRemoveAt < list.length - 1) {
					return list[toRemoveAt];
				}

				return null;
			};

			settings.beforeActivate = function (newItem) {
				var currentItem = computed();

				if (!newItem) {
					newItem = settings.determineNextItemToActivate(items, currentItem ? items.indexOf(currentItem) : 0);
				} else {
					var index = items.indexOf(newItem);

					if (index == -1) {
						items.push(newItem);
					} else {
						newItem = items()[index];
					}
				}

				return newItem;
			};

			settings.afterDeactivate = function (oldItem, close) {
				if (close) {
					items.remove(oldItem);
				}
			};

			var originalCanDeactivate = computed.canDeactivate;
			computed.canDeactivate = function (close) {
				if (close) {
					return system.defer(function (dfd) {
						var list = items();
						var results = [];

						function finish() {
							for (var j = 0; j < results.length; j++) {
								if (!results[j]) {
									dfd.resolve(false);
									return;
								}
							}

							dfd.resolve(true);
						}

						for (var i = 0; i < list.length; i++) {
							computed.canDeactivateItem(list[i], close).then(function (result) {
								results.push(result);
								if (results.length == list.length) {
									finish();
								}
							});
						}
					}).promise();
				} else {
					return originalCanDeactivate();
				}
			};

			var originalDeactivate = computed.deactivate;
			computed.deactivate = function (close) {
				if (close) {
					return system.defer(function (dfd) {
						var list = items();
						var results = 0;
						var listLength = list.length;

						function doDeactivate(item) {
							computed.deactivateItem(item, close).then(function () {
								results++;
								items.remove(item);
								if (results == listLength) {
									dfd.resolve();
								}
							});
						}

						for (var i = 0; i < listLength; i++) {
							doDeactivate(list[i]);
						}
					}).promise();
				} else {
					return originalDeactivate();
				}
			};

			return computed;
		};

		return computed;
	}

	/**
     * @class ActivatorSettings
     * @static
     */
	var activatorSettings = {
		/**
         * The default value passed to an object's deactivate function as its close parameter.
         * @property {boolean} closeOnDeactivate
         * @default true
         */
		closeOnDeactivate: true,
		/**
         * Lower-cased words which represent a truthy value.
         * @property {string[]} affirmations
         * @default ['yes', 'ok', 'true']
         */
		affirmations: ['yes', 'ok', 'true'],
		/**
         * Interprets the response of a `canActivate` or `canDeactivate` call using the known affirmative values in the `affirmations` array.
         * @method interpretResponse
         * @param {object} value
         * @return {boolean}
         */
		interpretResponse: function (value) {
			if (system.isObject(value)) {
				value = value.can || false;
			}

			if (system.isString(value)) {
				return ko.utils.arrayIndexOf(this.affirmations, value.toLowerCase()) !== -1;
			}

			return value;
		},
		/**
         * Determines whether or not the current item and the new item are the same.
         * @method areSameItem
         * @param {object} currentItem
         * @param {object} newItem
         * @param {object} currentActivationData
         * @param {object} newActivationData
         * @return {boolean}
         */
		areSameItem: function (currentItem, newItem, currentActivationData, newActivationData) {
			return currentItem == newItem;
		},
		/**
         * Called immediately before the new item is activated.
         * @method beforeActivate
         * @param {object} newItem
         */
		beforeActivate: function (newItem) {
			return newItem;
		},
		/**
         * Called immediately after the old item is deactivated.
         * @method afterDeactivate
         * @param {object} oldItem The previous item.
         * @param {boolean} close Whether or not the previous item was closed.
         * @param {function} setter The activate item setter function.
         */
		afterDeactivate: function (oldItem, close, setter) {
			if (close && setter) {
				setter(null);
			}
		}
	};

	/**
     * @class ActivatorModule
     * @static
     */
	activator = {
		/**
         * The default settings used by activators.
         * @property {ActivatorSettings} defaults
         */
		defaults: activatorSettings,
		/**
          * Creates a new activator.
          * @method create
          * @param {object} [initialActiveItem] The item which should be immediately activated upon creation of the ativator.
          * @param {ActivatorSettings} [settings] Per activator overrides of the default activator settings.
          * @return {Activator} The created activator.
          */
		create: createActivator,
		/**
         * Determines whether or not the provided object is an activator or not.
         * @method isActivator
         * @param {object} object Any object you wish to verify as an activator or not.
         * @return {boolean} True if the object is an activator; false otherwise.
         */
		isActivator: function (object) {
			return object && object.__activator__;
		}
	};

	return activator;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The composition module encapsulates all functionality related to visual composition.
 * @module composition
 * @requires system
 * @requires viewLocator
 * @requires binder
 * @requires viewEngine
 * @requires activator
 * @requires jquery
 * @requires knockout
 */
define('durandal/composition', ['durandal/system', 'durandal/viewLocator', 'durandal/binder', 'durandal/viewEngine', 'durandal/activator', 'jquery', 'knockout'], function (system, viewLocator, binder, viewEngine, activator, $, ko) {
	var dummyModel = {},
        activeViewAttributeName = 'data-active-view',
        composition,
        compositionCompleteCallbacks = [],
        compositionCount = 0,
        compositionDataKey = 'durandal-composition-data',
        partAttributeName = 'data-part',
        partAttributeSelector = '[' + partAttributeName + ']',
        bindableSettings = ['model', 'view', 'transition', 'area', 'strategy', 'activationData'];

	function getHostState(parent) {
		var elements = [];
		var state = {
			childElements: elements,
			activeView: null
		};

		var child = ko.virtualElements.firstChild(parent);

		while (child) {
			if (child.nodeType == 1) {
				elements.push(child);
				if (child.getAttribute(activeViewAttributeName)) {
					state.activeView = child;
				}
			}

			child = ko.virtualElements.nextSibling(child);
		}

		if (!state.activeView) {
			state.activeView = elements[0];
		}

		return state;
	}

	function endComposition() {
		compositionCount--;

		if (compositionCount === 0) {
			setTimeout(function () {
				var i = compositionCompleteCallbacks.length;

				while (i--) {
					compositionCompleteCallbacks[i]();
				}

				compositionCompleteCallbacks = [];
			}, 1);
		}
	}

	function tryActivate(context, successCallback, skipActivation) {
		if (skipActivation) {
			successCallback();
		} else if (context.activate && context.model && context.model.activate) {
			var result;

			if (system.isArray(context.activationData)) {
				result = context.model.activate.apply(context.model, context.activationData);
			} else {
				result = context.model.activate(context.activationData);
			}

			if (result && result.then) {
				result.then(successCallback);
			} else if (result || result === undefined) {
				successCallback();
			} else {
				endComposition();
			}
		} else {
			successCallback();
		}
	}

	function triggerAttach() {
		var context = this;

		if (context.activeView) {
			context.activeView.removeAttribute(activeViewAttributeName);
		}

		if (context.child) {
			if (context.model && context.model.attached) {
				if (context.composingNewView || context.alwaysTriggerAttach) {
					context.model.attached(context.child, context.parent, context);
				}
			}

			if (context.attached) {
				context.attached(context.child, context.parent, context);
			}

			context.child.setAttribute(activeViewAttributeName, true);

			if (context.composingNewView && context.model) {
				if (context.model.compositionComplete) {
					composition.current.complete(function () {
						context.model.compositionComplete(context.child, context.parent, context);
					});
				}

				if (context.model.detached) {
					ko.utils.domNodeDisposal.addDisposeCallback(context.child, function () {
						context.model.detached(context.child, context.parent, context);
					});
				}
			}

			if (context.compositionComplete) {
				if (!context.model || context.compositionComplete !== context.model.compositionComplete)
					composition.current.complete(function () {
						context.compositionComplete(context.child, context.parent, context);
					});
			}
		}

		endComposition();
		context.triggerAttach = system.noop;
	}

	function shouldTransition(context) {
		if (system.isString(context.transition)) {
			if (context.activeView) {
				if (context.activeView == context.child) {
					return false;
				}

				if (!context.child) {
					return true;
				}

				if (context.skipTransitionOnSameViewId) {
					var currentViewId = context.activeView.getAttribute('data-view');
					var newViewId = context.child.getAttribute('data-view');
					return currentViewId != newViewId;
				}
			}

			return true;
		}

		return false;
	}

	function cloneNodes(nodesArray) {
		for (var i = 0, j = nodesArray.length, newNodesArray = []; i < j; i++) {
			var clonedNode = nodesArray[i].cloneNode(true);
			newNodesArray.push(clonedNode);
		}
		return newNodesArray;
	}

	function replaceParts(context) {
		var parts = cloneNodes(context.parts);
		var replacementParts = composition.getParts(parts);
		var standardParts = composition.getParts(context.child);

		for (var partId in replacementParts) {
			$(standardParts[partId]).replaceWith(replacementParts[partId]);
		}
	}

	function removePreviousView(parent) {
		var children = ko.virtualElements.childNodes(parent), i, len;

		if (!system.isArray(children)) {
			var arrayChildren = [];

			for (i = 0, len = children.length; i < len; i++) {
				arrayChildren[i] = children[i];
			}

			children = arrayChildren;
		}

		for (i = 1, len = children.length; i < len; i++) {
			ko.removeNode(children[i]);
		}
	}

	/**
     * @class CompositionTransaction
     * @static
     */
	var compositionTransaction = {
		/**
         * Registers a callback which will be invoked when the current composition transaction has completed. The transaction includes all parent and children compositions.
         * @method complete
         * @param {function} callback The callback to be invoked when composition is complete.
         */
		complete: function (callback) {
			compositionCompleteCallbacks.push(callback);
		},
		off: function (callback) {
			var i;
			do {
				i = compositionCompleteCallbacks.indexOf(callback);
				i >= 0 && compositionCompleteCallbacks.splice(i, 1);
			}
			while (i >= 0);
		},
	};

	/**
     * @class CompositionModule
     * @static
     */
	composition = {
		/**
         * Converts a transition name to its moduleId.
         * @method convertTransitionToModuleId
         * @param {string} name The name of the transtion.
         * @return {string} The moduleId.
         */
		convertTransitionToModuleId: function (name) {
			return 'durandal/transitions/' + name;
		},
		/**
         * The name of the transition to use in all compositions.
         * @property {string} defaultTransitionName
         * @default null
         */
		defaultTransitionName: null,
		/**
         * Represents the currently executing composition transaction.
         * @property {CompositionTransaction} current
         */
		current: compositionTransaction,
		/**
         * Registers a binding handler that will be invoked when the current composition transaction is complete.
         * @method addBindingHandler
         * @param {string} name The name of the binding handler.
         * @param {object} [config] The binding handler instance. If none is provided, the name will be used to look up an existing handler which will then be converted to a composition handler.
         * @param {function} [initOptionsFactory] If the registered binding needs to return options from its init call back to knockout, this function will server as a factory for those options. It will receive the same parameters that the init function does.
         */
		addBindingHandler: function (name, config, initOptionsFactory) {
			var key,
                dataKey = 'composition-handler-' + name,
                handler;

			config = config || ko.bindingHandlers[name];
			initOptionsFactory = initOptionsFactory || function () { return undefined; };

			handler = ko.bindingHandlers[name] = {
				init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
					var data = {
						trigger: ko.observable(null)
					};

					composition.current.complete(function () {
						if (config.init) {
							config.init(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
						}

						if (config.update) {
							ko.utils.domData.set(element, dataKey, config);
							data.trigger('trigger');
						}
					});

					ko.utils.domData.set(element, dataKey, data);

					return initOptionsFactory(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
				},
				update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
					var data = ko.utils.domData.get(element, dataKey);

					if (data.update) {
						return data.update(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
					}

					data.trigger();
				}
			};

			for (key in config) {
				if (key !== "init" && key !== "update") {
					handler[key] = config[key];
				}
			}
		},
		/**
         * Gets an object keyed with all the elements that are replacable parts, found within the supplied elements. The key will be the part name and the value will be the element itself.
         * @method getParts
         * @param {DOMElement\DOMElement[]} elements The element(s) to search for parts.
         * @return {object} An object keyed by part.
         */
		getParts: function (elements) {
			var parts = {};

			if (!system.isArray(elements)) {
				elements = [elements];
			}

			for (var i = 0; i < elements.length; i++) {
				var element = elements[i];

				if (element.getAttribute) {
					var id = element.getAttribute(partAttributeName);
					if (id) {
						parts[id] = element;
					}

					var childParts = $(partAttributeSelector, element)
                        .not($('[data-bind] ' + partAttributeSelector, element));

					for (var j = 0; j < childParts.length; j++) {
						var part = childParts.get(j);
						parts[part.getAttribute(partAttributeName)] = part;
					}
				}
			}

			return parts;
		},
		cloneNodes: cloneNodes,
		finalize: function (context) {
			context.transition = context.transition || this.defaultTransitionName;

			if (!context.child && !context.activeView) {
				if (!context.cacheViews) {
					ko.virtualElements.emptyNode(context.parent);
				}

				context.triggerAttach();
			} else if (shouldTransition(context)) {
				var transitionModuleId = this.convertTransitionToModuleId(context.transition);

				system.acquire(transitionModuleId).then(function (transition) {
					context.transition = transition;

					transition(context).then(function () {
						if (!context.cacheViews) {
							if (!context.child) {
								ko.virtualElements.emptyNode(context.parent);
							} else {
								removePreviousView(context.parent);
							}
						} else if (context.activeView) {
							var instruction = binder.getBindingInstruction(context.activeView);
							if (instruction.cacheViews != undefined && !instruction.cacheViews) {
								ko.removeNode(context.activeView);
							}
						}

						context.triggerAttach();
					});
				}).fail(function (err) {
					system.error('Failed to load transition (' + transitionModuleId + '). Details: ' + err.message);
				});
			} else {
				if (context.child != context.activeView) {
					if (context.cacheViews && context.activeView) {
						var instruction = binder.getBindingInstruction(context.activeView);
						if (instruction.cacheViews != undefined && !instruction.cacheViews) {
							ko.removeNode(context.activeView);
						} else {
							$(context.activeView).hide();
						}
					}

					if (!context.child) {
						if (!context.cacheViews) {
							ko.virtualElements.emptyNode(context.parent);
						}
					} else {
						if (!context.cacheViews) {
							removePreviousView(context.parent);
						}

						$(context.child).show();
					}
				}

				context.triggerAttach();
			}
		},
		bindAndShow: function (child, context, skipActivation) {
			context.child = child;

			if (context.cacheViews) {
				context.composingNewView = (ko.utils.arrayIndexOf(context.viewElements, child) == -1);
			} else {
				context.composingNewView = true;
			}

			tryActivate(context, function () {
				if (context.binding) {
					context.binding(context.child, context.parent, context);
				}

				if (context.preserveContext && context.bindingContext) {
					if (context.composingNewView) {
						if (context.parts) {
							replaceParts(context);
						}

						$(child).hide();
						ko.virtualElements.prepend(context.parent, child);

						binder.bindContext(context.bindingContext, child, context.model);
					}
				} else if (child) {
					var modelToBind = context.model || dummyModel;
					var currentModel = ko.dataFor(child);

					if (currentModel != modelToBind) {
						if (!context.composingNewView) {
							$(child).remove();
							viewEngine.createView(child.getAttribute('data-view')).then(function (recreatedView) {
								composition.bindAndShow(recreatedView, context, true);
							});
							return;
						}

						if (context.parts) {
							replaceParts(context);
						}

						$(child).hide();
						ko.virtualElements.prepend(context.parent, child);

						binder.bind(modelToBind, child);
					}
				}

				composition.finalize(context);
			}, skipActivation);
		},
		/**
         * Eecutes the default view location strategy.
         * @method defaultStrategy
         * @param {object} context The composition context containing the model and possibly existing viewElements.
         * @return {promise} A promise for the view.
         */
		defaultStrategy: function (context) {
			return viewLocator.locateViewForObject(context.model, context.area, context.viewElements);
		},
		getSettings: function (valueAccessor, element) {
			var value = valueAccessor(),
                settings = ko.utils.unwrapObservable(value) || {},
                activatorPresent = activator.isActivator(value),
                moduleId;

			if (system.isString(settings)) {
				if (viewEngine.isViewUrl(settings)) {
					settings = {
						view: settings
					};
				} else {
					settings = {
						model: settings,
						activate: true
					};
				}

				return settings;
			}

			moduleId = system.getModuleId(settings);
			if (moduleId) {
				settings = {
					model: settings,
					activate: true
				};

				return settings;
			}

			if (!activatorPresent && settings.model) {
				activatorPresent = activator.isActivator(settings.model);
			}

			for (var attrName in settings) {
				if (ko.utils.arrayIndexOf(bindableSettings, attrName) != -1) {
					settings[attrName] = ko.utils.unwrapObservable(settings[attrName]);
				} else {
					settings[attrName] = settings[attrName];
				}
			}

			if (activatorPresent) {
				settings.activate = false;
			} else if (settings.activate === undefined) {
				settings.activate = true;
			}

			return settings;
		},
		executeStrategy: function (context) {
			context.strategy(context).then(function (child) {
				composition.bindAndShow(child, context);
			});
		},
		inject: function (context) {
			if (!context.model) {
				this.bindAndShow(null, context);
				return;
			}

			if (context.view) {
				viewLocator.locateView(context.view, context.area, context.viewElements).then(function (child) {
					composition.bindAndShow(child, context);
				});
				return;
			}

			if (!context.strategy) {
				context.strategy = this.defaultStrategy;
			}

			if (system.isString(context.strategy)) {
				system.acquire(context.strategy).then(function (strategy) {
					context.strategy = strategy;
					composition.executeStrategy(context);
				}).fail(function (err) {
					system.error('Failed to load view strategy (' + context.strategy + '). Details: ' + err.message);
				});
			} else {
				this.executeStrategy(context);
			}
		},
		/**
         * Initiates a composition.
         * @method compose
         * @param {DOMElement} element The DOMElement or knockout virtual element that serves as the parent for the composition.
         * @param {object} settings The composition settings.
         * @param {object} [bindingContext] The current binding context.
         */
		compose: function (element, settings, bindingContext, fromBinding) {
			compositionCount++;

			if (!fromBinding) {
				settings = composition.getSettings(function () { return settings; }, element);
			}

			var hostState = getHostState(element);

			settings.activeView = hostState.activeView;
			settings.parent = element;
			settings.triggerAttach = triggerAttach;
			settings.bindingContext = bindingContext;

			if (settings.cacheViews && !settings.viewElements) {
				settings.viewElements = hostState.childElements;
			}

			if (!settings.model) {
				if (!settings.view) {
					this.bindAndShow(null, settings);
				} else {
					settings.area = settings.area || 'partial';
					settings.preserveContext = true;

					viewLocator.locateView(settings.view, settings.area, settings.viewElements).then(function (child) {
						composition.bindAndShow(child, settings);
					});
				}
			} else if (system.isString(settings.model)) {
				system.acquire(settings.model).then(function (module) {
					settings.model = system.resolveObject(module);
					composition.inject(settings);
				}).fail(function (err) {
					system.error('Failed to load composed module (' + settings.model + '). Details: ' + err.message);
				});
			} else {
				composition.inject(settings);
			}
		}
	};

	ko.bindingHandlers.compose = {
		init: function () {
			return { controlsDescendantBindings: true };
		},
		update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
			var settings = composition.getSettings(valueAccessor, element);
			if (settings.mode) {
				var data = ko.utils.domData.get(element, compositionDataKey);
				if (!data) {
					var childNodes = ko.virtualElements.childNodes(element);
					data = {};

					if (settings.mode === 'inline') {
						data.view = viewEngine.ensureSingleElement(childNodes);
					} else if (settings.mode === 'templated') {
						data.parts = cloneNodes(childNodes);
					}

					ko.virtualElements.emptyNode(element);
					ko.utils.domData.set(element, compositionDataKey, data);
				}

				if (settings.mode === 'inline') {
					settings.view = data.view.cloneNode(true);
				} else if (settings.mode === 'templated') {
					settings.parts = data.parts;
				}

				settings.preserveContext = true;
			}

			composition.compose(element, settings, bindingContext, true);
		}
	};

	ko.virtualElements.allowedBindings.compose = true;

	return composition;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * Durandal events originate from backbone.js but also combine some ideas from signals.js as well as some additional improvements.
 * Events can be installed into any object and are installed into the `app` module by default for convenient app-wide eventing.
 * @module events
 * @requires system
 */
define('durandal/events', ['durandal/system'], function (system) {
    var eventSplitter = /\s+/;
    var Events = function() { };

    /**
     * Represents an event subscription.
     * @class Subscription
     */
    var Subscription = function(owner, events) {
        this.owner = owner;
        this.events = events;
    };

    /**
     * Attaches a callback to the event subscription.
     * @method then
     * @param {function} callback The callback function to invoke when the event is triggered.
     * @param {object} [context] An object to use as `this` when invoking the `callback`.
     * @chainable
     */
    Subscription.prototype.then = function (callback, context) {
        this.callback = callback || this.callback;
        this.context = context || this.context;
        
        if (!this.callback) {
            return this;
        }

        this.owner.on(this.events, this.callback, this.context);
        return this;
    };

    /**
     * Attaches a callback to the event subscription.
     * @method on
     * @param {function} [callback] The callback function to invoke when the event is triggered. If `callback` is not provided, the previous callback will be re-activated.
     * @param {object} [context] An object to use as `this` when invoking the `callback`.
     * @chainable
     */
    Subscription.prototype.on = Subscription.prototype.then;

    /**
     * Cancels the subscription.
     * @method off
     * @chainable
     */
    Subscription.prototype.off = function () {
        this.owner.off(this.events, this.callback, this.context);
        return this;
    };

    /**
     * Creates an object with eventing capabilities.
     * @class Events
     */

    /**
     * Creates a subscription or registers a callback for the specified event.
     * @method on
     * @param {string} events One or more events, separated by white space.
     * @param {function} [callback] The callback function to invoke when the event is triggered. If `callback` is not provided, a subscription instance is returned.
     * @param {object} [context] An object to use as `this` when invoking the `callback`.
     * @return {Subscription|Events} A subscription is returned if no callback is supplied, otherwise the events object is returned for chaining.
     */
    Events.prototype.on = function(events, callback, context) {
        var calls, event, list;

        if (!callback) {
            return new Subscription(this, events);
        } else {
            calls = this.callbacks || (this.callbacks = {});
            events = events.split(eventSplitter);

            while (event = events.shift()) {
                list = calls[event] || (calls[event] = []);
                list.push(callback, context);
            }

            return this;
        }
    };

    /**
     * Removes the callbacks for the specified events.
     * @method off
     * @param {string} [events] One or more events, separated by white space to turn off. If no events are specified, then the callbacks will be removed.
     * @param {function} [callback] The callback function to remove. If `callback` is not provided, all callbacks for the specified events will be removed.
     * @param {object} [context] The object that was used as `this`. Callbacks with this context will be removed.
     * @chainable
     */
    Events.prototype.off = function(events, callback, context) {
        var event, calls, list, i;

        // No events
        if (!(calls = this.callbacks)) {
            return this;
        }

        //removing all
        if (!(events || callback || context)) {
            delete this.callbacks;
            return this;
        }

        events = events ? events.split(eventSplitter) : system.keys(calls);

        // Loop through the callback list, splicing where appropriate.
        while (event = events.shift()) {
            if (!(list = calls[event]) || !(callback || context)) {
                delete calls[event];
                continue;
            }

            for (i = list.length - 2; i >= 0; i -= 2) {
                if (!(callback && list[i] !== callback || context && list[i + 1] !== context)) {
                    list.splice(i, 2);
                }
            }
        }

        return this;
    };

    /**
     * Triggers the specified events.
     * @method trigger
     * @param {string} [events] One or more events, separated by white space to trigger.
     * @chainable
     */
    Events.prototype.trigger = function(events) {
        var event, calls, list, i, length, args, all, rest;
        if (!(calls = this.callbacks)) {
            return this;
        }

        rest = [];
        events = events.split(eventSplitter);
        for (i = 1, length = arguments.length; i < length; i++) {
            rest[i - 1] = arguments[i];
        }

        // For each event, walk through the list of callbacks twice, first to
        // trigger the event, then to trigger any `"all"` callbacks.
        while (event = events.shift()) {
            // Copy callback lists to prevent modification.
            if (all = calls.all) {
                all = all.slice();
            }

            if (list = calls[event]) {
                list = list.slice();
            }

            // Execute event callbacks.
            if (list) {
                for (i = 0, length = list.length; i < length; i += 2) {
                    list[i].apply(list[i + 1] || this, rest);
                }
            }

            // Execute "all" callbacks.
            if (all) {
                args = [event].concat(rest);
                for (i = 0, length = all.length; i < length; i += 2) {
                    all[i].apply(all[i + 1] || this, args);
                }
            }
        }

        return this;
    };

    /**
     * Creates a function that will trigger the specified events when called. Simplifies proxying jQuery (or other) events through to the events object.
     * @method proxy
     * @param {string} events One or more events, separated by white space to trigger by invoking the returned function.
     * @return {function} Calling the function will invoke the previously specified events on the events object.
     */
    Events.prototype.proxy = function(events) {
        var that = this;
        return (function(arg) {
            that.trigger(events, arg);
        });
    };

    /**
     * Creates an object with eventing capabilities.
     * @class EventsModule
     * @static
     */

    /**
     * Adds eventing capabilities to the specified object.
     * @method includeIn
     * @param {object} targetObject The object to add eventing capabilities to.
     */
    Events.includeIn = function(targetObject) {
        targetObject.on = Events.prototype.on;
        targetObject.off = Events.prototype.off;
        targetObject.trigger = Events.prototype.trigger;
        targetObject.proxy = Events.prototype.proxy;
    };

    return Events;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The app module controls app startup, plugin loading/configuration and root visual display.
 * @module app
 * @requires system
 * @requires viewEngine
 * @requires composition
 * @requires events
 * @requires jquery
 */
define('durandal/app', ['durandal/system', 'durandal/viewEngine', 'durandal/composition', 'durandal/events', 'jquery'], function(system, viewEngine, composition, Events, $) {
    var app,
        allPluginIds = [],
        allPluginConfigs = [];

    function loadPlugins(){
        return system.defer(function(dfd){
            if(allPluginIds.length == 0){
                dfd.resolve();
                return;
            }

            system.acquire(allPluginIds).then(function(loaded){
                for(var i = 0; i < loaded.length; i++){
                    var currentModule = loaded[i];

                    if(currentModule.install){
                        var config = allPluginConfigs[i];
                        if(!system.isObject(config)){
                            config = {};
                        }

                        currentModule.install(config);
                        system.log('Plugin:Installed ' + allPluginIds[i]);
                    }else{
                        system.log('Plugin:Loaded ' + allPluginIds[i]);
                    }
                }

                dfd.resolve();
            }).fail(function(err){
                system.error('Failed to load plugin(s). Details: ' + err.message);
            });
        }).promise();
    }

    /**
     * @class AppModule
     * @static
     * @uses Events
     */
    app = {
        /**
         * The title of your application.
         * @property {string} title
         */
        title: 'Application',
        /**
         * Configures one or more plugins to be loaded and installed into the application.
         * @method configurePlugins
         * @param {object} config Keys are plugin names. Values can be truthy, to simply install the plugin, or a configuration object to pass to the plugin.
         * @param {string} [baseUrl] The base url to load the plugins from.
         */
        configurePlugins:function(config, baseUrl){
            var pluginIds = system.keys(config);
            baseUrl = baseUrl || 'plugins/';

            if(baseUrl.indexOf('/', baseUrl.length - 1) === -1){
                baseUrl += '/';
            }

            for(var i = 0; i < pluginIds.length; i++){
                var key = pluginIds[i];
                allPluginIds.push(baseUrl + key);
                allPluginConfigs.push(config[key]);
            }
        },
        /**
         * Starts the application.
         * @method start
         * @return {promise}
         */
        start: function() {
            system.log('Application:Starting');

            if (this.title) {
                document.title = this.title;
            }

            return system.defer(function (dfd) {
                $(function() {
                    loadPlugins().then(function(){
                        dfd.resolve();
                        system.log('Application:Started');
                    });
                });
            }).promise();
        },
        /**
         * Sets the root module/view for the application.
         * @method setRoot
         * @param {string} root The root view or module.
         * @param {string} [transition] The transition to use from the previous root (or splash screen) into the new root.
         * @param {string} [applicationHost] The application host element or id. By default the id 'applicationHost' will be used.
         */
        setRoot: function(root, transition, applicationHost) {
            var hostElement, settings = { activate:true, transition: transition };

            if (!applicationHost || system.isString(applicationHost)) {
                hostElement = document.getElementById(applicationHost || 'applicationHost');
            } else {
                hostElement = applicationHost;
            }

            if (system.isString(root)) {
                if (viewEngine.isViewUrl(root)) {
                    settings.view = root;
                } else {
                    settings.model = root;
                }
            } else {
                settings.model = root;
            }

            composition.compose(hostElement, settings);
        }
    };

    Events.includeIn(app);

    return app;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * This module is based on Backbone's core history support. It abstracts away the low level details of working with browser history and url changes in order to provide a solid foundation for a router.
 * @module history
 * @requires system
 * @requires jquery
 */
define('plugins/history', ['durandal/system', 'jquery'], function (system, $) {
    // Cached regex for stripping a leading hash/slash and trailing space.
    var routeStripper = /^[#\/]|\s+$/g;

    // Cached regex for stripping leading and trailing slashes.
    var rootStripper = /^\/+|\/+$/g;

    // Cached regex for detecting MSIE.
    var isExplorer = /msie [\w.]+/;

    // Cached regex for removing a trailing slash.
    var trailingSlash = /\/$/;

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    function updateHash(location, fragment, replace) {
        if (replace) {
            var href = location.href.replace(/(javascript:|#).*$/, '');
            location.replace(href + '#' + fragment);
        } else {
            // Some browsers require that `hash` contains a leading #.
            location.hash = '#' + fragment;
        }
    };

    /**
     * @class HistoryModule
     * @static
     */
    var history = {
        /**
         * The setTimeout interval used when the browser does not support hash change events.
         * @property {string} interval
         * @default 50
         */
        interval: 50,
        /**
         * Indicates whether or not the history module is actively tracking history.
         * @property {string} active
         */
        active: false
    };
    
    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
        history.location = window.location;
        history.history = window.history;
    }

    /**
     * Gets the true hash value. Cannot use location.hash directly due to a bug in Firefox where location.hash will always be decoded.
     * @method getHash
     * @param {string} [window] The optional window instance
     * @return {string} The hash.
     */
    history.getHash = function(window) {
        var match = (window || history).location.href.match(/#(.*)$/);
        return match ? match[1] : '';
    };
    
    /**
     * Get the cross-browser normalized URL fragment, either from the URL, the hash, or the override.
     * @method getFragment
     * @param {string} fragment The fragment.
     * @param {boolean} forcePushState Should we force push state?
     * @return {string} he fragment.
     */
    history.getFragment = function(fragment, forcePushState) {
        if (fragment == null) {
            if (history._hasPushState || !history._wantsHashChange || forcePushState) {
                fragment = history.location.pathname;
                var root = history.root.replace(trailingSlash, '');
                if (!fragment.indexOf(root)) {
                    fragment = fragment.substr(root.length);
                }
            } else {
                fragment = history.getHash();
            }
        }
        
        return fragment.replace(routeStripper, '');
    };

    /**
     * Activate the hash change handling, returning `true` if the current URL matches an existing route, and `false` otherwise.
     * @method activate
     * @param {HistoryOptions} options.
     * @return {boolean|undefined} Returns true/false from loading the url unless the silent option was selected.
     */
    history.activate = function(options) {
        if (history.active) {
            system.error("History has already been activated.");
        }

        history.active = true;

        // Figure out the initial configuration. Do we need an iframe?
        // Is pushState desired ... is it available?
        history.options = system.extend({}, { root: '/' }, history.options, options);
        history.root = history.options.root;
        history._wantsHashChange = history.options.hashChange !== false;
        history._wantsPushState = !!history.options.pushState;
        history._hasPushState = !!(history.options.pushState && history.history && history.history.pushState);

        var fragment = history.getFragment();
        var docMode = document.documentMode;
        var oldIE = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

        // Normalize root to always include a leading and trailing slash.
        history.root = ('/' + history.root + '/').replace(rootStripper, '/');

        if (oldIE && history._wantsHashChange) {
            history.iframe = $('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo('body')[0].contentWindow;
            history.navigate(fragment, false);
        }

        // Depending on whether we're using pushState or hashes, and whether
        // 'onhashchange' is supported, determine how we check the URL state.
        if (history._hasPushState) {
            $(window).on('popstate', history.checkUrl);
        } else if (history._wantsHashChange && ('onhashchange' in window) && !oldIE) {
            $(window).on('hashchange', history.checkUrl);
        } else if (history._wantsHashChange) {
            history._checkUrlInterval = setInterval(history.checkUrl, history.interval);
        }

        // Determine if we need to change the base url, for a pushState link
        // opened by a non-pushState browser.
        history.fragment = fragment;
        var loc = history.location;
        var atRoot = loc.pathname.replace(/[^\/]$/, '$&/') === history.root;

        // Transition from hashChange to pushState or vice versa if both are requested.
        if (history._wantsHashChange && history._wantsPushState) {
            // If we've started off with a route from a `pushState`-enabled
            // browser, but we're currently in a browser that doesn't support it...
            if (!history._hasPushState && !atRoot) {
                history.fragment = history.getFragment(null, true);
                history.location.replace(history.root + history.location.search + '#' + history.fragment);
                // Return immediately as browser will do redirect to new url
                return true;

            // Or if we've started out with a hash-based route, but we're currently
            // in a browser where it could be `pushState`-based instead...
            } else if (history._hasPushState && atRoot && loc.hash) {
                this.fragment = history.getHash().replace(routeStripper, '');
                this.history.replaceState({}, document.title, history.root + history.fragment + loc.search);
            }
        }

        if (!history.options.silent) {
            return history.loadUrl();
        }
    };

    /**
     * Disable history, perhaps temporarily. Not useful in a real app, but possibly useful for unit testing Routers.
     * @method deactivate
     */
    history.deactivate = function() {
        $(window).off('popstate', history.checkUrl).off('hashchange', history.checkUrl);
        clearInterval(history._checkUrlInterval);
        history.active = false;
    };

    /**
     * Checks the current URL to see if it has changed, and if it has, calls `loadUrl`, normalizing across the hidden iframe.
     * @method checkUrl
     * @return {boolean} Returns true/false from loading the url.
     */
    history.checkUrl = function() {
        var current = history.getFragment();
        if (current === history.fragment && history.iframe) {
            current = history.getFragment(history.getHash(history.iframe));
        }

        if (current === history.fragment) {
            return false;
        }

        if (history.iframe) {
            history.navigate(current, false);
        }
        
        history.loadUrl();
    };
    
    /**
     * Attempts to load the current URL fragment. A pass-through to options.routeHandler.
     * @method loadUrl
     * @return {boolean} Returns true/false from the route handler.
     */
    history.loadUrl = function(fragmentOverride) {
        var fragment = history.fragment = history.getFragment(fragmentOverride);

        return history.options.routeHandler ?
            history.options.routeHandler(fragment) :
            false;
    };

    /**
     * Save a fragment into the hash history, or replace the URL state if the
     * 'replace' option is passed. You are responsible for properly URL-encoding
     * the fragment in advance.
     * The options object can contain `trigger: false` if you wish to not have the
     * route callback be fired, or `replace: true`, if
     * you wish to modify the current URL without adding an entry to the history.
     * @method navigate
     * @param {string} fragment The url fragment to navigate to.
     * @param {object|boolean} options An options object with optional trigger and replace flags. You can also pass a boolean directly to set the trigger option. Trigger is `true` by default.
     * @return {boolean} Returns true/false from loading the url.
     */
    history.navigate = function(fragment, options) {
        if (!history.active) {
            return false;
        }

        if(options === undefined) {
            options = {
                trigger: true
            };
        }else if(system.isBoolean(options)) {
            options = {
                trigger: options
            };
        }

        fragment = history.getFragment(fragment || '');

        if (history.fragment === fragment) {
            return;
        }

        history.fragment = fragment;
        var url = history.root + fragment;

        // If pushState is available, we use it to set the fragment as a real URL.
        if (history._hasPushState) {
            history.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

            // If hash changes haven't been explicitly disabled, update the hash
            // fragment to store history.
        } else if (history._wantsHashChange) {
            updateHash(history.location, fragment, options.replace);
            
            if (history.iframe && (fragment !== history.getFragment(history.getHash(history.iframe)))) {
                // Opening and closing the iframe tricks IE7 and earlier to push a
                // history entry on hash-tag change.  When replace is true, we don't
                // want history.
                if (!options.replace) {
                    history.iframe.document.open().close();
                }
                
                updateHash(history.iframe.location, fragment, options.replace);
            }

            // If you've told us that you explicitly don't want fallback hashchange-
            // based history, then `navigate` becomes a page refresh.
        } else {
            return history.location.assign(url);
        }

        if (options.trigger) {
            return history.loadUrl(fragment);
        }
    };

    /**
     * Navigates back in the browser history.
     * @method navigateBack
     */
    history.navigateBack = function() {
        history.history.back();
    };

    /**
     * @class HistoryOptions
     * @static
     */

    /**
     * The function that will be called back when the fragment changes.
     * @property {function} routeHandler
     */

    /**
     * The url root used to extract the fragment when using push state.
     * @property {string} root
     */

    /**
     * Use hash change when present.
     * @property {boolean} hashChange
     * @default true
     */

    /**
     * Use push state when present.
     * @property {boolean} pushState
     * @default false
     */

    /**
     * Prevents loading of the current url when activating history.
     * @property {boolean} silent
     * @default false
     */

    return history;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * Connects the history module's url and history tracking support to Durandal's activation and composition engine allowing you to easily build navigation-style applications.
 * @module router
 * @requires system
 * @requires app
 * @requires activator
 * @requires events
 * @requires composition
 * @requires history
 * @requires knockout
 * @requires jquery
 */
define('plugins/router', ['durandal/system', 'durandal/app', 'durandal/activator', 'durandal/events', 'durandal/composition', 'plugins/history', 'knockout', 'jquery'], function (system, app, activator, events, composition, history, ko, $) {
	var optionalParam = /\((.*?)\)/g;
	var unwrap = ko.utils.unwrapObservable;
	var namedParam = /(\(\?)?:\w+/g;
	var splatParam = /\*\w+/g;
	var escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;
	var startDeferred, rootRouter;
	var trailingSlash = /\/$/;

	function routeStringToRegExp(routeString) {
		routeString = routeString.replace(escapeRegExp, '\\$&')
            .replace(optionalParam, '(?:$1)?')
            .replace(namedParam, function (match, optional) {
            	return optional ? match : '([^\/]+)';
            })
            .replace(splatParam, '(.*?)');

		return new RegExp('^' + routeString + '$');
	}

	function stripParametersFromRoute(route) {
		var colonIndex = route.indexOf(':');
		var length = colonIndex > 0 ? colonIndex - 1 : route.length;
		return route.substring(0, length);
	}

	function hasChildRouter(instance) {
		return instance.router && instance.router.loadUrl;
	}

	function endsWith(str, suffix) {
		return str.indexOf(suffix, str.length - suffix.length) !== -1;
	}

	function compareArrays(first, second) {
		if (!first || !second) {
			return false;
		}

		if (first.length != second.length) {
			return false;
		}

		for (var i = 0, len = first.length; i < len; i++) {
			if (first[i] != second[i]) {
				return false;
			}
		}

		return true;
	}

	/**
     * @class Router
     * @uses Events
     */

	/**
     * Triggered when the navigation logic has completed.
     * @event router:navigation:complete
     * @param {object} instance The activated instance.
     * @param {object} instruction The routing instruction.
     * @param {Router} router The router.
     */

	/**
     * Triggered when the navigation has been cancelled.
     * @event router:navigation:cancelled
     * @param {object} instance The activated instance.
     * @param {object} instruction The routing instruction.
     * @param {Router} router The router.
     */

	/**
     * Triggered right before a route is activated.
     * @event router:route:activating
     * @param {object} instance The activated instance.
     * @param {object} instruction The routing instruction.
     * @param {Router} router The router.
     */

	/**
     * Triggered right before a route is configured.
     * @event router:route:before-config
     * @param {object} config The route config.
     * @param {Router} router The router.
     */

	/**
     * Triggered just after a route is configured.
     * @event router:route:after-config
     * @param {object} config The route config.
     * @param {Router} router The router.
     */

	/**
     * Triggered when the view for the activated instance is attached.
     * @event router:navigation:attached
     * @param {object} instance The activated instance.
     * @param {object} instruction The routing instruction.
     * @param {Router} router The router.
     */

	/**
     * Triggered when the composition that the activated instance participates in is complete.
     * @event router:navigation:composition-complete
     * @param {object} instance The activated instance.
     * @param {object} instruction The routing instruction.
     * @param {Router} router The router.
     */

	/**
     * Triggered when the router does not find a matching route.
     * @event router:route:not-found
     * @param {string} fragment The url fragment.
     * @param {Router} router The router.
     */

	var createRouter = function () {
		var queue = [],
            isProcessing = ko.observable(false),
            isNavigatingExplicitly = ko.observable(false),
            currentActivation = ko.observable(),
            currentInstruction = ko.observable(),
            activeItem = activator.create();

		var router = {
			/**
             * The route handlers that are registered. Each handler consists of a `routePattern` and a `callback`.
             * @property {object[]} handlers
             */
			handlers: [],
			/**
             * The route configs that are registered.
             * @property {object[]} routes
             */
			routes: [],
			/**
             * The route configurations that have been designated as displayable in a nav ui (nav:true).
             * @property {KnockoutObservableArray} navigationModel
             */
			navigationModel: ko.observableArray([]),
			/**
             * The active item/screen based on the current navigation state.
             * @property {Activator} activeItem
             */
			activeItem: activeItem,
			currentInstruction: currentInstruction,
			currentActivation: currentActivation,
			/**
             * Indicates that the router (or a child router) is currently in the process of navigating.
             * @property {KnockoutComputed} isNavigating
             */
			isNavigating: ko.computed({
				read: function () {
					var current = activeItem();
					var processing = isProcessing();
					var navigatingExplicitly = isNavigatingExplicitly();
					var currentRouterIsProcesing = current
						&& current.router
						&& current.router != router
						&& current.router.isNavigating() ? true : false;
					return navigatingExplicitly || processing || currentRouterIsProcesing;
				},
				write: function (value) {
					if (isNavigatingExplicitly() !== value)
						isNavigatingExplicitly(value);
				}
			}),
			/**
             * An observable surfacing the active routing instruction that is currently being processed or has recently finished processing.
             * The instruction object has `config`, `fragment`, `queryString`, `params` and `queryParams` properties.
             * @property {KnockoutObservable} activeInstruction
             */
			activeInstruction: ko.observable(null),
			__router__: true
		};

		events.includeIn(router);

		activeItem.settings.areSameItem = function (currentItem, newItem, currentActivationData, newActivationData) {
			if (currentItem == newItem) {
				return compareArrays(currentActivationData, newActivationData);
			}

			return false;
		};

		function completeNavigation(instance, instruction) {
			system.log('Navigation Complete', instance, instruction);

			var fromModuleId = system.getModuleId(currentActivation());
			if (fromModuleId) {
				router.trigger('router:navigation:from:' + fromModuleId);
			}

			currentActivation(instance);
			currentInstruction(instruction);

			var toModuleId = system.getModuleId(currentActivation());
			if (toModuleId) {
				router.trigger('router:navigation:to:' + toModuleId);
			}

			if (!hasChildRouter(instance)) {
				router.updateDocumentTitle(instance, instruction);
			}

			isProcessing(false);
			rootRouter.explicitNavigation = false;
			rootRouter.navigatingBack = false;
			router.trigger('router:navigation:complete', instance, instruction, router);
		}

		function cancelNavigation(instance, instruction) {
			//system.log('Navigation Cancelled');
			console.error('Navigation Cancelled');
			router.activeInstruction(currentInstruction());

			if (currentInstruction()) {
				router.navigate(currentInstruction().fragment, false);
			}

			isProcessing(false);
			rootRouter.explicitNavigation = false;
			rootRouter.navigatingBack = false;
			router.trigger('router:navigation:cancelled', instance, instruction, router);
		}

		function redirect(url) {
			system.log('Navigation Redirecting');

			isProcessing(false);
			rootRouter.explicitNavigation = false;
			rootRouter.navigatingBack = false;
			router.navigate(url, { trigger: true, replace: true });
		}

		function activateRoute(activator, instance, instruction) {
			rootRouter.navigatingBack = !rootRouter.explicitNavigation && currentActivation != instruction.fragment;
			router.trigger('router:route:activating', instance, instruction, router);

			activator.activateItem(instance, instruction.params).then(function (succeeded) {
				//console.log("activator.activateItem:" + succeeded)
				if (succeeded) {
					var previousActivation = currentActivation();
					completeNavigation(instance, instruction);

					if (hasChildRouter(instance)) {
						queueInstruction({
							router: instance.router,
							fragment: instruction.fragment,
							queryString: instruction.queryString
						});
					}

					if (previousActivation == instance) {
						router.attached();
					}
				} else if (activator.settings.lifecycleData && activator.settings.lifecycleData.redirect) {
					redirect(activator.settings.lifecycleData.redirect);
				} else {
					console.log("activateRoute:cancelNavigation");

					cancelNavigation(instance, instruction);
				}

				if (startDeferred) {
					startDeferred.resolve();
					startDeferred = null;
				}
			});
		}

		/**
         * Inspects routes and modules before activation. Can be used to protect access by cancelling navigation or redirecting.
         * @method guardRoute
         * @param {object} instance The module instance that is about to be activated by the router.
         * @param {object} instruction The route instruction. The instruction object has config, fragment, queryString, params and queryParams properties.
         * @return {Promise|Boolean|String} If a boolean, determines whether or not the route should activate or be cancelled. If a string, causes a redirect to the specified route. Can also be a promise for either of these value types.
         */
		function handleGuardedRoute(activator, instance, instruction) {
			var resultOrPromise = router.guardRoute(instance, instruction);
			if (resultOrPromise) {
				if (resultOrPromise.then) {
					resultOrPromise.then(function (result) {
						if (result) {
							if (system.isString(result)) {
								redirect(result);
							} else {
								activateRoute(activator, instance, instruction);
							}
						} else {
							console.log("handleGuardedRoute:cancelNavigation - result is falsy:" + result);
							cancelNavigation(instance, instruction);
						}
					});
				} else {
					if (system.isString(resultOrPromise)) {
						redirect(resultOrPromise);
					} else {
						activateRoute(activator, instance, instruction);
					}
				}
			} else {
				console.log("handleGuardedRoute:cancelNavigation - resultOrPromise is falsy:" + resultOrPromise);
				cancelNavigation(instance, instruction);
			}
		}

		function ensureActivation(activator, instance, instruction) {
			if (router.guardRoute) {
				handleGuardedRoute(activator, instance, instruction);
			} else {
				activateRoute(activator, instance, instruction);
			}
		}

		function canReuseCurrentActivation(instruction) {
			return currentInstruction()
                && currentInstruction().config.moduleId == instruction.config.moduleId
                && currentActivation()
                && ((currentActivation().canReuseForRoute && currentActivation().canReuseForRoute.apply(currentActivation(), instruction.params))
                || (currentActivation().router && currentActivation().router.loadUrl));
		}

		function dequeueInstruction() {
			if (isProcessing()) {
				return;
			}

			var instruction = queue.shift();
			queue = [];

			if (!instruction) {
				return;
			}

			if (instruction.router) {
				var fullFragment = instruction.fragment;
				if (instruction.queryString) {
					fullFragment += "?" + instruction.queryString;
				}

				instruction.router.loadUrl(fullFragment);
				return;
			}

			isProcessing(true);
			router.activeInstruction(instruction);

			if (canReuseCurrentActivation(instruction)) {
				ensureActivation(activator.create(), currentActivation(), instruction);
			} else {
				system.acquire(instruction.config.moduleId).then(function (module) {
					var instance = system.resolveObject(module);
					ensureActivation(activeItem, instance, instruction);
				}).fail(function (err) {
					system.error('Failed to load routed module (' + instruction.config.moduleId + '). Details: ' + err.message);
				});
			}
		}

		function queueInstruction(instruction) {
			queue.unshift(instruction);
			dequeueInstruction();
		}

		// Given a route, and a URL fragment that it matches, return the array of
		// extracted decoded parameters. Empty or unmatched parameters will be
		// treated as `null` to normalize cross-browser behavior.
		function createParams(routePattern, fragment, queryString) {
			var params = routePattern.exec(fragment).slice(1);

			for (var i = 0; i < params.length; i++) {
				var current = params[i];
				params[i] = current ? decodeURIComponent(current) : null;
			}

			var queryParams = router.parseQueryString(queryString);
			if (queryParams) {
				params.push(queryParams);
			}

			return {
				params: params,
				queryParams: queryParams
			};
		}

		function configureRoute(config) {
			router.trigger('router:route:before-config', config, router);

			if (!system.isRegExp(config)) {
				config.title = config.title || router.convertRouteToTitle(config.route);
				config.moduleId = config.moduleId || router.convertRouteToModuleId(config.route);
				config.hash = config.hash || router.convertRouteToHash(config.route);
				config.routePattern = routeStringToRegExp(config.route);
			} else {
				config.routePattern = config.route;
			}

			router.trigger('router:route:after-config', config, router);

			router.routes.push(config);

			router.route(config.routePattern, function (fragment, queryString) {
				var paramInfo = createParams(config.routePattern, fragment, queryString);
				queueInstruction({
					fragment: fragment,
					queryString: queryString,
					config: config,
					params: paramInfo.params,
					queryParams: paramInfo.queryParams
				});
			});
		};

		function mapRoute(config) {
			if (system.isArray(config.route)) {
				for (var i = 0, length = config.route.length; i < length; i++) {
					var current = system.extend({}, config);
					current.route = config.route[i];
					if (i > 0) {
						delete current.menu;
					}
					configureRoute(current);
				}
			} else {
				configureRoute(config);
			}

			return router;
		}

		function addActiveFlag(config) {
			if (config.isActive) {
				return;
			}

			config.isActive = ko.computed(function () {
				var theItem = activeItem();
				return theItem && theItem.__moduleId__ == config.moduleId;
			});
		}

		/**
         * Parses a query string into an object.
         * @method parseQueryString
         * @param {string} queryString The query string to parse.
         * @return {object} An object keyed according to the query string parameters.
         */
		router.parseQueryString = function (queryString) {
			var queryObject, pairs;

			if (!queryString) {
				return null;
			}

			pairs = queryString.split('&');

			if (pairs.length == 0) {
				return null;
			}

			queryObject = {};

			for (var i = 0; i < pairs.length; i++) {
				var pair = pairs[i];
				if (pair === '') {
					continue;
				}

				var parts = pair.split('=');
				queryObject[parts[0]] = parts[1] && decodeURIComponent(parts[1].replace(/\+/g, ' '));
			}

			return queryObject;
		};

		/**
         * Add a route to be tested when the url fragment changes.
         * @method route
         * @param {RegEx} routePattern The route pattern to test against.
         * @param {function} callback The callback to execute when the route pattern is matched.
         */
		router.route = function (routePattern, callback) {
			router.handlers.push({ routePattern: routePattern, callback: callback });
		};

		/**
         * Attempt to load the specified URL fragment. If a route succeeds with a match, returns `true`. If no defined routes matches the fragment, returns `false`.
         * @method loadUrl
         * @param {string} fragment The URL fragment to find a match for.
         * @return {boolean} True if a match was found, false otherwise.
         */
		router.loadUrl = function (fragment) {
			var handlers = router.handlers,
                queryString = null,
                coreFragment = fragment,
                queryIndex = fragment.indexOf('?');

			if (queryIndex != -1) {
				coreFragment = fragment.substring(0, queryIndex);
				queryString = fragment.substr(queryIndex + 1);
			}

			if (router.relativeToParentRouter) {
				var instruction = this.parent.activeInstruction();
				coreFragment = instruction.params.join('/');

				if (coreFragment && coreFragment[0] == '/') {
					coreFragment = coreFragment.substr(1);
				}

				if (!coreFragment) {
					coreFragment = '';
				}

				coreFragment = coreFragment.replace('//', '/').replace('//', '/');
			}

			coreFragment = coreFragment.replace(trailingSlash, '');

			for (var i = 0; i < handlers.length; i++) {
				var current = handlers[i];
				if (current.routePattern.test(coreFragment)) {
					current.callback(coreFragment, queryString);
					return true;
				}
			}

			system.log('Route Not Found: "' + fragment + '"');
			router.trigger('router:route:not-found', fragment, router);

			if (currentInstruction) {
				history.navigate(currentInstruction.fragment, { trigger: false, replace: true });
			}

			rootRouter.explicitNavigation = false;
			rootRouter.navigatingBack = false;

			return false;
		};

		/**
         * Updates the document title based on the activated module instance, the routing instruction and the app.title.
         * @method updateDocumentTitle
         * @param {object} instance The activated module.
         * @param {object} instruction The routing instruction associated with the action. It has a `config` property that references the original route mapping config.
         */
		router.updateDocumentTitle = function (instance, instruction) {
			if (instruction.config.title) {
				if (app.title) {
					document.title = unwrap(instruction.config.title) + " | " + unwrap(app.title);
				} else {
					document.title = unwrap(instruction.config.title);
				}
			} else if (app.title) {
				document.title = app.title;
			}
		};

		/**
         * Save a fragment into the hash history, or replace the URL state if the
         * 'replace' option is passed. You are responsible for properly URL-encoding
         * the fragment in advance.
         * The options object can contain `trigger: false` if you wish to not have the
         * route callback be fired, or `replace: true`, if
         * you wish to modify the current URL without adding an entry to the history.
         * @method navigate
         * @param {string} fragment The url fragment to navigate to.
         * @param {object|boolean} options An options object with optional trigger and replace flags. You can also pass a boolean directly to set the trigger option. Trigger is `true` by default.
         * @return {boolean} Returns true/false from loading the url.
         */
		router.navigate = function (fragment, options) {
			if (fragment && fragment.indexOf('://') != -1) {
				window.location.href = fragment;
				return true;
			}

			rootRouter.explicitNavigation = true;
			return history.navigate(fragment, options);
		};

		/**
         * Navigates back in the browser history.
         * @method navigateBack
         */
		router.navigateBack = function () {
			history.navigateBack();
		};

		router.attached = function () {
			setTimeout(function () {
				isProcessing(false);
				router.trigger('router:navigation:attached', currentActivation(), currentInstruction(), router);
				dequeueInstruction();
			}, 10);
		};

		router.compositionComplete = function () {
			router.trigger('router:navigation:composition-complete', currentActivation, currentInstruction, router);
		};

		/**
         * Converts a route to a hash suitable for binding to a link's href.
         * @method convertRouteToHash
         * @param {string} route
         * @return {string} The hash.
         */
		router.convertRouteToHash = function (route) {
			if (router.relativeToParentRouter) {
				var instruction = router.parent.activeInstruction(),
                    hash = instruction.config.hash + '/' + route;

				if (history._hasPushState) {
					hash = '/' + hash;
				}

				hash = hash.replace('//', '/').replace('//', '/');
				return hash;
			}

			if (history._hasPushState) {
				return route;
			}

			return "#" + route;
		};

		/**
         * Converts a route to a module id. This is only called if no module id is supplied as part of the route mapping.
         * @method convertRouteToModuleId
         * @param {string} route
         * @return {string} The module id.
         */
		router.convertRouteToModuleId = function (route) {
			return stripParametersFromRoute(route);
		};

		/**
         * Converts a route to a displayable title. This is only called if no title is specified as part of the route mapping.
         * @method convertRouteToTitle
         * @param {string} route
         * @return {string} The title.
         */
		router.convertRouteToTitle = function (route) {
			var value = stripParametersFromRoute(route);
			return value.substring(0, 1).toUpperCase() + value.substring(1);
		};

		/**
         * Maps route patterns to modules.
         * @method map
         * @param {string|object|object[]} route A route, config or array of configs.
         * @param {object} [config] The config for the specified route.
         * @chainable
         * @example
 router.map([
    { route: '', title:'Home', moduleId: 'homeScreen', nav: true },
    { route: 'customer/:id', moduleId: 'customerDetails'}
 ]);
         */
		router.map = function (route, config) {
			if (system.isArray(route)) {
				for (var i = 0; i < route.length; i++) {
					router.map(route[i]);
				}

				return router;
			}

			if (system.isString(route) || system.isRegExp(route)) {
				if (!config) {
					config = {};
				} else if (system.isString(config)) {
					config = { moduleId: config };
				}

				config.route = route;
			} else {
				config = route;
			}

			return mapRoute(config);
		};

		/**
         * Builds an observable array designed to bind a navigation UI to. The model will exist in the `navigationModel` property.
         * @method buildNavigationModel
         * @param {number} defaultOrder The default order to use for navigation visible routes that don't specify an order. The defualt is 100.
         * @chainable
         */
		router.buildNavigationModel = function (defaultOrder) {
			var nav = [], routes = router.routes;
			defaultOrder = defaultOrder || 100;

			for (var i = 0; i < routes.length; i++) {
				var current = routes[i];

				if (current.menu) {
					if (!system.isNumber(current.menu)) {
						current.menu = defaultOrder;
					}

					addActiveFlag(current);
					nav.push(current);
				}
			}

			nav.sort(function (a, b) { return a.menu - b.menu; });
			router.navigationModel(nav);

			return router;
		};

		/**
         * Configures how the router will handle unknown routes.
         * @method mapUnknownRoutes
         * @param {string|function} [config] If not supplied, then the router will map routes to modules with the same name.
         * If a string is supplied, it represents the module id to route all unknown routes to.
         * Finally, if config is a function, it will be called back with the route instruction containing the route info. The function can then modify the instruction by adding a moduleId and the router will take over from there.
         * @param {string} [replaceRoute] If config is a module id, then you can optionally provide a route to replace the url with.
         * @chainable
         */
		router.mapUnknownRoutes = function (config, replaceRoute) {
			var catchAllRoute = "*catchall";
			var catchAllPattern = routeStringToRegExp(catchAllRoute);

			router.route(catchAllPattern, function (fragment, queryString) {
				var paramInfo = createParams(catchAllPattern, fragment, queryString);
				var instruction = {
					fragment: fragment,
					queryString: queryString,
					config: {
						route: catchAllRoute,
						routePattern: catchAllPattern
					},
					params: paramInfo.params,
					queryParams: paramInfo.queryParams
				};

				if (!config) {
					instruction.config.moduleId = fragment;
				} else if (system.isString(config)) {
					instruction.config.moduleId = config;
					if (replaceRoute) {
						history.navigate(replaceRoute, { trigger: false, replace: true });
					}
				} else if (system.isFunction(config)) {
					var result = config(instruction);
					if (result && result.then) {
						result.then(function () {
							router.trigger('router:route:before-config', instruction.config, router);
							router.trigger('router:route:after-config', instruction.config, router);
							queueInstruction(instruction);
						});
						return;
					}
				} else {
					instruction.config = config;
					instruction.config.route = catchAllRoute;
					instruction.config.routePattern = catchAllPattern;
				}

				router.trigger('router:route:before-config', instruction.config, router);
				router.trigger('router:route:after-config', instruction.config, router);
				queueInstruction(instruction);
			});

			return router;
		};

		/**
         * Resets the router by removing handlers, routes, event handlers and previously configured options.
         * @method reset
         * @chainable
         */
		router.reset = function () {
			currentInstruction = currentActivation = undefined;
			router.handlers = [];
			router.routes = [];
			router.off();
			delete router.options;
			return router;
		};

		/**
         * Makes all configured routes and/or module ids relative to a certain base url.
         * @method makeRelative
         * @param {string|object} settings If string, the value is used as the base for routes and module ids. If an object, you can specify `route` and `moduleId` separately. In place of specifying route, you can set `fromParent:true` to make routes automatically relative to the parent router's active route.
         * @chainable
         */
		router.makeRelative = function (settings) {
			if (system.isString(settings)) {
				settings = {
					moduleId: settings,
					route: settings
				};
			}

			if (settings.moduleId && !endsWith(settings.moduleId, '/')) {
				settings.moduleId += '/';
			}

			if (settings.route && !endsWith(settings.route, '/')) {
				settings.route += '/';
			}

			if (settings.fromParent) {
				router.relativeToParentRouter = true;
			}

			router.on('router:route:before-config').then(function (config) {
				if (settings.moduleId) {
					config.moduleId = settings.moduleId + config.moduleId;
				}

				if (settings.route) {
					if (config.route !== null && config.route !== undefined) {
						if (config.route === '') {
							config.route = settings.route.substring(0, settings.route.length - 1);
						} else {
							config.route = settings.route + config.route;
						}
					}
					else config.route = '';
				}
			});

			return router;
		};

		/**
         * Creates a child router.
         * @method createChildRouter
         * @return {Router} The child router.
         */
		router.createChildRouter = function () {
			var childRouter = createRouter();
			childRouter.parent = router;
			return childRouter;
		};

		return router;
	};

	/**
     * @class RouterModule
     * @extends Router
     * @static
     */
	rootRouter = createRouter();
	rootRouter.explicitNavigation = false;
	rootRouter.navigatingBack = false;

	/**
     * Activates the router and the underlying history tracking mechanism.
     * @method activate
     * @return {Promise} A promise that resolves when the router is ready.
     */
	rootRouter.activate = function (options) {
		console.log('Activating Router');
		return system.defer(function (dfd) {
			startDeferred = dfd;
			rootRouter.options = system.extend({ routeHandler: rootRouter.loadUrl }, rootRouter.options, options);

			history.activate(rootRouter.options);

			if (history._hasPushState) {
				var routes = rootRouter.routes,
                    i = routes.length;

				while (i--) {
					var current = routes[i];
					current.hash = current.hash.replace('#', '');
				}
			}

			$(document).delegate("a", 'click', function (evt) {
				rootRouter.explicitNavigation = true;

				if (history._hasPushState) {
					if (!evt.altKey && !evt.ctrlKey && !evt.metaKey && !evt.shiftKey) {
						// Get the anchor href and protcol
						var href = $(this).attr("href");
						var protocol = this.protocol + "//";

						// Ensure the protocol is not part of URL, meaning its relative.
						// Stop the event bubbling to ensure the link will not cause a page refresh.
						if (!href || (href.charAt(0) !== "#" && href.slice(protocol.length) !== protocol)) {
							evt.preventDefault();
							history.navigate(href);
						}
					}
				}
			});
		}).promise();
	};

	/**
     * Disable history, perhaps temporarily. Not useful in a real app, but possibly useful for unit testing Routers.
     * @method deactivate
     */
	rootRouter.deactivate = function () {
		history.deactivate();
	};

	/**
     * Installs the router's custom ko binding handler.
     * @method install
     */
	rootRouter.install = function () {
		ko.bindingHandlers.router = {
			init: function () {
				return { controlsDescendantBindings: true };
			},
			update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
				var settings = ko.utils.unwrapObservable(valueAccessor()) || {};

				if (settings.__router__) {
					settings = {
						model: settings.activeItem(),
						attached: settings.attached,
						compositionComplete: settings.compositionComplete,
						activate: false
					};
				} else {
					var theRouter = ko.utils.unwrapObservable(settings.router || viewModel.router) || rootRouter;
					settings.model = theRouter.activeItem();
					settings.attached = theRouter.attached;
					settings.compositionComplete = theRouter.compositionComplete;
					settings.activate = false;
				}

				composition.compose(element, settings, bindingContext);
			}
		};

		ko.virtualElements.allowedBindings.router = true;
	};

	return rootRouter;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * The dialog module enables the display of message boxes, custom modal dialogs and other overlays or slide-out UI abstractions. Dialogs are constructed by the composition system which interacts with a user defined dialog context. The dialog module enforced the activator lifecycle.
 * @module dialog
 * @requires system
 * @requires app
 * @requires composition
 * @requires activator
 * @requires viewEngine
 * @requires jquery
 * @requires knockout
 */
define('plugins/dialog', ['durandal/system', 'durandal/app', 'durandal/composition', 'durandal/activator', 'durandal/viewEngine', 'jquery', 'knockout'], function (system, app, composition, activator, viewEngine, $, ko) {
    var contexts = {},
        dialogCount = 0,
        dialog;

    /**
     * Models a message box's message, title and options.
     * @class MessageBox
     */
    var MessageBox = function(message, title, options) {
        this.message = message;
        this.title = title || MessageBox.defaultTitle;
        this.options = options || MessageBox.defaultOptions;
    };

    /**
     * Selects an option and closes the message box, returning the selected option through the dialog system's promise.
     * @method selectOption
     * @param {string} dialogResult The result to select.
     */
    MessageBox.prototype.selectOption = function (dialogResult, index) {
        dialog.close(this, dialogResult, index);
    };

    /**
     * Provides the view to the composition system.
     * @method getView
     * @return {DOMElement} The view of the message box.
     */
    MessageBox.prototype.getView = function(){
        return viewEngine.processMarkup(MessageBox.defaultViewMarkup);
    };

    /**
     * Configures a custom view to use when displaying message boxes.
     * @method setViewUrl
     * @param {string} viewUrl The view url relative to the base url which the view locator will use to find the message box's view.
     * @static
     */
    MessageBox.setViewUrl = function(viewUrl){
        delete MessageBox.prototype.getView;
        MessageBox.prototype.viewUrl = viewUrl;
    };

    /**
     * The title to be used for the message box if one is not provided.
     * @property {string} defaultTitle
     * @default Application
     * @static
     */
    MessageBox.defaultTitle = app.title || 'Application';

    /**
     * The options to display in the message box of none are specified.
     * @property {string[]} defaultOptions
     * @default ['Ok']
     * @static
     */
    MessageBox.defaultOptions = ['Ok'];

    /**
     * The markup for the message box's view.
     * @property {string} defaultViewMarkup
     * @static
     */
    MessageBox.defaultViewMarkup = [
        '<div data-view="plugins/messageBox" class="messageBox">',
            '<div class="modal-header">',
                '<h3 data-bind="text: title"></h3>',
            '</div>',
            '<div class="modal-body">',
                '<p class="message" data-bind="html: message"></p>',
            '</div>',
            '<div class="modal-footer row" data-bind="foreach: options">',
				'<span data-bind="css: \'opt-\'+ (12/$parent.options.length)">',
                '<button class="btn" data-bind="click: function () { $parent.selectOption($data, $index()); }, text: $data, css: { \'btn-0\': $index() == 0, \'btn-1\': $index() == 1, \'btn-cancel\': $index() == 1, \'btn-save\': $index() == 0, autofocus: $index() == 0, \'btn-2\': $index() == 2, \'btn-3\': $index() == 3, \'btn-4\': $index() == 4 }"></button></span>',
            '</div>',
        '</div>'
    ].join('\n');

    function ensureDialogInstance(objOrModuleId) {
        return system.defer(function(dfd) {
            if (system.isString(objOrModuleId)) {
                system.acquire(objOrModuleId).then(function (module) {
                    dfd.resolve(system.resolveObject(module));
                }).fail(function(err){
                    system.error('Failed to load dialog module (' + objOrModuleId + '). Details: ' + err.message);
                });
            } else {
                dfd.resolve(objOrModuleId);
            }
        }).promise();
    }

    /**
     * @class DialogModule
     * @static
     */
    dialog = {
        /**
         * The constructor function used to create message boxes.
         * @property {MessageBox} MessageBox
         */
        MessageBox:MessageBox,
        /**
         * The css zIndex that the last dialog was displayed at.
         * @property {number} currentZIndex
         */
        currentZIndex: 1050,
        /**
         * Gets the next css zIndex at which a dialog should be displayed.
         * @method getNextZIndex
         * @return {number} The next usable zIndex.
         */
        getNextZIndex: function () {
            return ++this.currentZIndex;
        },
        /**
         * Determines whether or not there are any dialogs open.
         * @method isOpen
         * @return {boolean} True if a dialog is open. false otherwise.
         */
        isOpen: function() {
            return dialogCount > 0;
        },
        /**
         * Gets the dialog context by name or returns the default context if no name is specified.
         * @method getContext
         * @param {string} [name] The name of the context to retrieve.
         * @return {DialogContext} True context.
         */
        getContext: function(name) {
            return contexts[name || 'default'];
        },
        /**
         * Adds (or replaces) a dialog context.
         * @method addContext
         * @param {string} name The name of the context to add.
         * @param {DialogContext} dialogContext The context to add.
         */
        addContext: function(name, dialogContext) {
            dialogContext.name = name;
            contexts[name] = dialogContext;

            var helperName = 'show' + name.substr(0, 1).toUpperCase() + name.substr(1);
            this[helperName] = function (obj, activationData) {
                return this.show(obj, activationData, name);
            };
        },
        createCompositionSettings: function(obj, dialogContext) {
            var settings = {
                model:obj,
                activate:false
            };

            if (dialogContext.attached) {
                settings.attached = dialogContext.attached;
            }

            if (dialogContext.compositionComplete) {
                settings.compositionComplete = dialogContext.compositionComplete;
            }

            return settings;
        },
        /**
         * Gets the dialog model that is associated with the specified object.
         * @method getDialog
         * @param {object} obj The object for whom to retrieve the dialog.
         * @return {Dialog} The dialog model.
         */
        getDialog:function(obj){
            if(obj){
                return obj.__dialog__;
            }

            return undefined;
        },
        /**
         * Closes the dialog associated with the specified object.
         * @method close
         * @param {object} obj The object whose dialog should be closed.
         * @param {object} result* The results to return back to the dialog caller after closing.
         */
        close:function(obj){
            var theDialog = this.getDialog(obj);
            if(theDialog){
                var rest = Array.prototype.slice.call(arguments, 1);
                theDialog.close.apply(theDialog, rest);
            }
        },
        /**
         * Shows a dialog.
         * @method show
         * @param {object|string} obj The object (or moduleId) to display as a dialog.
         * @param {object} [activationData] The data that should be passed to the object upon activation.
         * @param {string} [context] The name of the dialog context to use. Uses the default context if none is specified.
         * @return {Promise} A promise that resolves when the dialog is closed and returns any data passed at the time of closing.
         */
        show: function(obj, activationData, context) {
            var that = this;
            var dialogContext = contexts[context || 'default'];

            return system.defer(function(dfd) {
                ensureDialogInstance(obj).then(function(instance) {
                    var dialogActivator = activator.create();

                    dialogActivator.activateItem(instance, activationData).then(function (success) {
                        if (success) {
                            var theDialog = instance.__dialog__ = {
                                owner: instance,
                                context: dialogContext,
                                activator: dialogActivator,
                                close: function () {
                                    var args = arguments;
                                    dialogActivator.deactivateItem(instance, true).then(function (closeSuccess) {
                                        if (closeSuccess) {
                                            dialogCount--;
                                            dialogContext.removeHost(theDialog);
                                            delete instance.__dialog__;

                                            if(args.length == 0){
                                                dfd.resolve();
                                            }else if(args.length == 1){
                                                dfd.resolve(args[0])
                                            }else{
                                                dfd.resolve.apply(dfd, args);
                                            }
                                        }
                                    });
                                }
                            };

                            theDialog.settings = that.createCompositionSettings(instance, dialogContext);
                            dialogContext.addHost(theDialog);

                            dialogCount++;
                            composition.compose(theDialog.host, theDialog.settings);
                        } else {
                            dfd.resolve(false);
                        }
                    });
                });
            }).promise();
        },
        /**
         * Shows a message box.
         * @method showMessage
         * @param {string} message The message to display in the dialog.
         * @param {string} [title] The title message.
         * @param {string[]} [options] The options to provide to the user.
         * @return {Promise} A promise that resolves when the message box is closed and returns the selected option.
         */
        showMessage:function(message, title, options){
            if(system.isString(this.MessageBox)){
                return dialog.show(this.MessageBox, [
                    message,
                    title || MessageBox.defaultTitle,
                    options || MessageBox.defaultOptions
                ]);
            }

            return dialog.show(new this.MessageBox(message, title, options));
        },
        /**
         * Installs this module into Durandal; called by the framework. Adds `app.showDialog` and `app.showMessage` convenience methods.
         * @method install
         * @param {object} [config] Add a `messageBox` property to supply a custom message box constructor. Add a `messageBoxView` property to supply custom view markup for the built-in message box.
         */
        install:function(config){
            app.showDialog = function(obj, activationData, context) {
                return dialog.show(obj, activationData, context);
            };

            app.showMessage = function(message, title, options) {
                return dialog.showMessage(message, title, options);
            };

            if(config.messageBox){
                dialog.MessageBox = config.messageBox;
            }

            if(config.messageBoxView){
                dialog.MessageBox.prototype.getView = function(){
                    return config.messageBoxView;
                };
            }
        }
    };

    /**
     * @class DialogContext
     */
    dialog.addContext('default', {
        blockoutOpacity: .2,
        removeDelay: 200,
        /**
         * In this function, you are expected to add a DOM element to the tree which will serve as the "host" for the modal's composed view. You must add a property called host to the modalWindow object which references the dom element. It is this host which is passed to the composition module.
         * @method addHost
         * @param {Dialog} theDialog The dialog model.
         */
        addHost: function(theDialog) {
            var body = $('body');
            var blockout = $('<div class="modalBlockout"></div>')
                .css({ 'z-index': dialog.getNextZIndex(), 'opacity': this.blockoutOpacity })
                .appendTo(body);

            var host = $('<div class="modalHost"></div>')
                .css({ 'z-index': dialog.getNextZIndex() })
                .appendTo(body);

            theDialog.host = host.get(0);
            theDialog.blockout = blockout.get(0);

            if (!dialog.isOpen()) {
                theDialog.oldBodyMarginRight = body.css("margin-right");
                theDialog.oldInlineMarginRight = body.get(0).style.marginRight;

                var html = $("html");
                var oldBodyOuterWidth = body.outerWidth(true);
                var oldScrollTop = html.scrollTop();
                $("html").css("overflow-y", "hidden");
                var newBodyOuterWidth = $("body").outerWidth(true);
                body.css("margin-right", (newBodyOuterWidth - oldBodyOuterWidth + parseInt(theDialog.oldBodyMarginRight)) + "px");
                html.scrollTop(oldScrollTop); // necessary for Firefox
            }
        },
        /**
         * This function is expected to remove any DOM machinery associated with the specified dialog and do any other necessary cleanup.
         * @method removeHost
         * @param {Dialog} theDialog The dialog model.
         */
        removeHost: function(theDialog) {
            $(theDialog.host).css('opacity', 0);
            $(theDialog.blockout).css('opacity', 0);

            setTimeout(function() {
                ko.removeNode(theDialog.host);
                ko.removeNode(theDialog.blockout);
            }, this.removeDelay);

            if (!dialog.isOpen()) {
                var html = $("html");
                var oldScrollTop = html.scrollTop(); // necessary for Firefox.
                html.css("overflow-y", "").scrollTop(oldScrollTop);

                if(theDialog.oldInlineMarginRight) {
                    $("body").css("margin-right", theDialog.oldBodyMarginRight);
                } else {
                    $("body").css("margin-right", '');
                }
            }
        },
        /**
         * This function is called after the modal is fully composed into the DOM, allowing your implementation to do any final modifications, such as positioning or animation. You can obtain the original dialog object by using `getDialog` on context.model.
         * @method compositionComplete
         * @param {DOMElement} child The dialog view.
         * @param {DOMElement} parent The parent view.
         * @param {object} context The composition context.
         */
        compositionComplete: function (child, parent, context) {
            var $child = $(child);
            var width = $child.width();
            var height = $child.height();
            var theDialog = dialog.getDialog(context.model);

            $child.css({
                'margin-top': (-height / 2).toString() + 'px',
                'margin-left': (-width / 2).toString() + 'px'
            });

            $(theDialog.host).css('opacity', 1);

            if ($(child).hasClass('autoclose')) {
                $(theDialog.blockout).click(function() {
                    theDialog.close();
                });
            }

            $('.autofocus', child).each(function() {
                $(this).focus();
            });
        }
    });

    return dialog;
});

/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
/**
 * Layers the widget sugar on top of the composition system.
 * @module widget
 * @requires system
 * @requires composition
 * @requires jquery
 * @requires knockout
 */
define('plugins/widget', ['durandal/system', 'durandal/composition', 'jquery', 'knockout'], function(system, composition, $, ko) {
    var kindModuleMaps = {},
        kindViewMaps = {},
        bindableSettings = ['model', 'view', 'kind'],
        widgetDataKey = 'durandal-widget-data';

    function extractParts(element, settings){
        var data = ko.utils.domData.get(element, widgetDataKey);

        if(!data){
            data = {
                parts:composition.cloneNodes(ko.virtualElements.childNodes(element))
            };

            ko.virtualElements.emptyNode(element);
            ko.utils.domData.set(element, widgetDataKey, data);
        }

        settings.parts = data.parts;
    }

    /**
     * @class WidgetModule
     * @static
     */
    var widget = {
        getSettings: function(valueAccessor) {
            var settings = ko.utils.unwrapObservable(valueAccessor()) || {};

            if (system.isString(settings)) {
                return { kind: settings };
            }

            for (var attrName in settings) {
                if (ko.utils.arrayIndexOf(bindableSettings, attrName) != -1) {
                    settings[attrName] = ko.utils.unwrapObservable(settings[attrName]);
                } else {
                    settings[attrName] = settings[attrName];
                }
            }

            return settings;
        },
        /**
         * Creates a ko binding handler for the specified kind.
         * @method registerKind
         * @param {string} kind The kind to create a custom binding handler for.
         */
        registerKind: function(kind) {
            ko.bindingHandlers[kind] = {
                init: function() {
                    return { controlsDescendantBindings: true };
                },
                update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                    var settings = widget.getSettings(valueAccessor);
                    settings.kind = kind;
                    extractParts(element, settings);
                    widget.create(element, settings, bindingContext, true);
                }
            };

            ko.virtualElements.allowedBindings[kind] = true;
        },
        /**
         * Maps views and module to the kind identifier if a non-standard pattern is desired.
         * @method mapKind
         * @param {string} kind The kind name.
         * @param {string} [viewId] The unconventional view id to map the kind to.
         * @param {string} [moduleId] The unconventional module id to map the kind to.
         */
        mapKind: function(kind, viewId, moduleId) {
            if (viewId) {
                kindViewMaps[kind] = viewId;
            }

            if (moduleId) {
                kindModuleMaps[kind] = moduleId;
            }
        },
        /**
         * Maps a kind name to it's module id. First it looks up a custom mapped kind, then falls back to `convertKindToModulePath`.
         * @method mapKindToModuleId
         * @param {string} kind The kind name.
         * @return {string} The module id.
         */
        mapKindToModuleId: function(kind) {
            return kindModuleMaps[kind] || widget.convertKindToModulePath(kind);
        },
        /**
         * Converts a kind name to it's module path. Used to conventionally map kinds who aren't explicitly mapped through `mapKind`.
         * @method convertKindToModulePath
         * @param {string} kind The kind name.
         * @return {string} The module path.
         */
        convertKindToModulePath: function(kind) {
            return 'widgets/' + kind + '/viewmodel';
        },
        /**
         * Maps a kind name to it's view id. First it looks up a custom mapped kind, then falls back to `convertKindToViewPath`.
         * @method mapKindToViewId
         * @param {string} kind The kind name.
         * @return {string} The view id.
         */
        mapKindToViewId: function(kind) {
            return kindViewMaps[kind] || widget.convertKindToViewPath(kind);
        },
        /**
         * Converts a kind name to it's view id. Used to conventionally map kinds who aren't explicitly mapped through `mapKind`.
         * @method convertKindToViewPath
         * @param {string} kind The kind name.
         * @return {string} The view id.
         */
        convertKindToViewPath: function(kind) {
            return 'widgets/' + kind + '/view';
        },
        createCompositionSettings: function(element, settings) {
            if (!settings.model) {
                settings.model = this.mapKindToModuleId(settings.kind);
            }

            if (!settings.view) {
                settings.view = this.mapKindToViewId(settings.kind);
            }

            settings.preserveContext = true;
            settings.activate = true;
            settings.activationData = settings;
            settings.mode = 'templated';

            return settings;
        },
        /**
         * Creates a widget.
         * @method create
         * @param {DOMElement} element The DOMElement or knockout virtual element that serves as the target element for the widget.
         * @param {object} settings The widget settings.
         * @param {object} [bindingContext] The current binding context.
         */
        create: function(element, settings, bindingContext, fromBinding) {
            if(!fromBinding){
                settings = widget.getSettings(function() { return settings; }, element);
            }

            var compositionSettings = widget.createCompositionSettings(element, settings);

            composition.compose(element, compositionSettings, bindingContext);
        },
        /**
         * Installs the widget module by adding the widget binding handler and optionally registering kinds.
         * @method install
         * @param {object} config The module config. Add a `kinds` array with the names of widgets to automatically register. You can also specify a `bindingName` if you wish to use another name for the widget binding, such as "control" for example.
         */
        install:function(config){
            config.bindingName = config.bindingName || 'widget';

            if(config.kinds){
                var toRegister = config.kinds;

                for(var i = 0; i < toRegister.length; i++){
                    widget.registerKind(toRegister[i]);
                }
            }

            ko.bindingHandlers[config.bindingName] = {
                init: function() {
                    return { controlsDescendantBindings: true };
                },
                update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
                    var settings = widget.getSettings(valueAccessor);
                    extractParts(element, settings);
                    widget.create(element, settings, bindingContext, true);
                }
            };

            ko.virtualElements.allowedBindings[config.bindingName] = true;
        }
    };

    return widget;
});

define('vendor', [ 
], function () {
	//WE SHOULD not have any code in here
});

(function () {
	//this is executed in NODEJS during the build optimization phase as it is, but in the browser with the above function
	requirejs.config({
		//By default, all modules are located relative to this path. If baseUrl
		//is not explicitly set, then all modules are loaded relative to
		//the directory that holds the build file. If appDir is set, then
		//baseUrl should be specified as relative to the appDir.
		baseUrl: 'js',
		waitSeconds: 30,
		catchError: {
			define: true
		},
		//Set paths for modules. If relative paths, set relative to baseUrl above.
		//If a special value of 'empty:' is used for the path value, then that
		//acts like mapping the path to an empty file. It allows the optimizer to
		//resolve the dependency to path, but then does not include it in the output.
		//Useful to map module names that are to resources on a CDN or other
		//http: URL when running in the browser and during an optimization that
		//file should be skipped because it has no dependencies.
		paths: {

			'durandal': 'vendor/hw/durandal',
			'plugins': 'vendor/hw/durandal/plugins',
			'transitions': 'vendor/hw/durandal/transitions',
			'text': 'vendor/requirejs/plugins/text',
			'async': 'vendor/requirejs/plugins/async',
			'json': 'vendor/requirejs/plugins/json',
			'css': 'vendor/requirejs/plugins/css',
			'vendor.jquery': 'jquery',

			//>>excludeEnd('build');
			//'bootstrap-datepicker': 'modules/bootstrap-datepicker/js/bootstrap-datepicker',
			//'snap': 'vendor/snapjs/snap',
		},
		//If shim config is used in the app during runtime, duplicate the config
		//here. Necessary if shim config is used, so that the shim's dependencies
		//are included in the build. Using 'mainConfigFile' is a better way to
		//pass this information though, so that it is only listed in one place.
		//However, if mainConfigFile is not an option, the shim config can be
		//inlined in the build config.
		shim: {
						'bootstrap-datepicker': {
				deps: [],
				exports: 'jQuery.fn.datepicker',
			},
			'vm/shared/aside': {
				deps: ['snap']
			},
		}
	});
})();
/* =========================================================
 * bootstrap-datepicker.js
 * http://www.eyecon.ro/bootstrap-datepicker
 * =========================================================
 * Copyright 2012 Stefan Petre
 * Improvements by Andrew Rowls
 * Updated for Bootstrap 3.x by Ian Serlin
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================= */

!function ($) {

	function UTCDate() {
		return new Date(Date.UTC.apply(Date, arguments));
	}
	function UTCToday() {
		var today = new Date();
		return UTCDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	}

	// Picker object

	var Datepicker = function (element, options) {
		var that = this;

		this.element = $(element);
		this.language = options.language || this.element.data('date-language') || "en";
		this.language = this.language in dates ? this.language : this.language.split('-')[0]; //Check if "de-DE" style date is available, if not language should fallback to 2 letter code eg "de"
		this.language = this.language in dates ? this.language : "en";
		this.isRTL = dates[this.language].rtl || false;
		this.format = DPGlobal.parseFormat(options.format || this.element.data('date-format') || dates[this.language].format || 'dd-mm-yyyy');
		this.isInline = false;
		this.isInput = this.element.is('input');
		this.component = this.element.is('.date') ? this.element.find('.input-group-addon, .btn') : false;
		this.hasInput = this.component && this.element.find('input').length;
		if (this.component && this.component.length === 0)
			this.component = false;

		this.forceParse = true;
		if ('forceParse' in options) {
			this.forceParse = options.forceParse;
		} else if ('dateForceParse' in this.element.data()) {
			this.forceParse = this.element.data('date-force-parse');
		}

		this.picker = $(DPGlobal.template);
		this._buildEvents();
		this._attachEvents();

		if (this.isInline) {
			this.picker.addClass('datepicker-inline').appendTo(this.element);
		} else {
			this.picker.insertAfter(this.element).addClass('datepicker-dropdown dropdown-menu moved');
		}
		if (this.isRTL) {
			this.picker.addClass('datepicker-rtl');
			this.picker.find('.prev i, .next i')
						.toggleClass('icon-arrow-left icon-arrow-right');
		}

		this.autoclose = false;
		if ('autoclose' in options) {
			this.autoclose = options.autoclose;
		} else if ('dateAutoclose' in this.element.data()) {
			this.autoclose = this.element.data('date-autoclose');
		}

		this.keyboardNavigation = true;
		if ('keyboardNavigation' in options) {
			this.keyboardNavigation = options.keyboardNavigation;
		} else if ('dateKeyboardNavigation' in this.element.data()) {
			this.keyboardNavigation = this.element.data('date-keyboard-navigation');
		}

		this.viewMode = this.startViewMode = 0;
		switch (options.startView || this.element.data('date-start-view')) {
			case 2:
			case 'decade':
				this.viewMode = this.startViewMode = 2;
				break;
			case 1:
			case 'year':
				this.viewMode = this.startViewMode = 1;
				break;
		}

		this.minViewMode = options.minViewMode || this.element.data('date-min-view-mode') || 0;
		if (typeof this.minViewMode === 'string') {
			switch (this.minViewMode) {
				case 'months':
					this.minViewMode = 1;
					break;
				case 'years':
					this.minViewMode = 2;
					break;
				default:
					this.minViewMode = 0;
					break;
			}
		}

		this.viewMode = this.startViewMode = Math.max(this.startViewMode, this.minViewMode);

		this.todayBtn = (options.todayBtn || this.element.data('date-today-btn') || false);
		this.todayHighlight = (options.todayHighlight || this.element.data('date-today-highlight') || false);

		this.calendarWeeks = false;
		if ('calendarWeeks' in options) {
			this.calendarWeeks = options.calendarWeeks;
		} else if ('dateCalendarWeeks' in this.element.data()) {
			this.calendarWeeks = this.element.data('date-calendar-weeks');
		}
		if (this.calendarWeeks)
			this.picker.find('tfoot th.today')
						.attr('colspan', function (i, val) {
							return parseInt(val) + 1;
						});

		this._allow_update = false;

		this.weekStart = ((options.weekStart || this.element.data('date-weekstart') || dates[this.language].weekStart || 0) % 7);
		this.weekEnd = ((this.weekStart + 6) % 7);
		this.startDate = -Infinity;
		this.endDate = Infinity;
		this.daysOfWeekDisabled = [];
		this.setStartDate(options.startDate || this.element.data('date-startdate'));
		this.setEndDate(options.endDate || this.element.data('date-enddate'));
		this.setDaysOfWeekDisabled(options.daysOfWeekDisabled || this.element.data('date-days-of-week-disabled'));
		this.fillDow();
		this.fillMonths();
		this.setRange(options.range);

		this._allow_update = true;

		this.update();
		this.showMode();

		if (this.isInline) {
			this.show();
		}
	};

	Datepicker.prototype = {
		constructor: Datepicker,

		_events: [],
		_secondaryEvents: [],
		_applyEvents: function (evs) {
			for (var i = 0, el, ev; i < evs.length; i++) {
				//console.log('datepicker _applyEvents', i, evs[i]);
				el = evs[i][0];
				ev = evs[i][1];
				el.on(ev);
			}
		},
		_unapplyEvents: function (evs) {
			for (var i = 0, el, ev; i < evs.length; i++) {
				el = evs[i][0];
				ev = evs[i][1];
				el.off(ev);
			}
		},
		_buildEvents: function () {
			//console.log("build events datepicker!!!!!", this.hasInput, this.isInput);
			if (this.isInput) { // single input
				//console.log(1);
				this._events = [
					[this.element, {
						click: $.proxy(this.toggle, this),
						keyup: $.proxy(this.update, this),
						keydown: $.proxy(this.keydown, this)
					}]
				];
			}
			else if (this.component && this.hasInput) { // component: input + button
				//console.log(2);
				this._events = [
					// For components that are not readonly, allow keyboard nav
					[this.element.find('input'), {
						click: $.proxy(this.show, this),
						keyup: $.proxy(this.update, this),
						keydown: $.proxy(this.keydown, this)
					}],
					[this.component, {
						click: $.proxy(this.show, this)
					}]
				];
			}
			else if (this.element.is('div')) {  // inline datepicker
				//console.log(3);
				this.isInline = true;
			}
			else {
				//console.log(4);
				this._events = [
					[this.element, {
						click: $.proxy(this.show, this)
					}]
				];
			}

			this._secondaryEvents = [
				[this.picker, {
					click: $.proxy(this.click, this)
				}],
				[$(window), {
					resize: $.proxy(this.place, this)
				}],
				[$(document), {
					//touchstart: $.proxy(function (e) {
					//	// Clicked outside the datepicker, hide it
					//	//if ($(e.target).closest('.datepicker.datepicker-inline, .datepicker.datepicker-dropdown').length === 0) {
					//	console.warn('TOUCHED DOCUMENT, CLOSING...');
					//	this.hide();
					//	//}
					//}, this),
					mousedown: $.proxy(function (e) {
						// Clicked outside the datepicker, hide it
						if ($(e.target).closest('.datepicker.datepicker-inline, .datepicker.datepicker-dropdown').length === 0) {
							this.hide();
						}
					}, this)
				}]
			];
		},
		_attachEvents: function () {
			//console.log('datepicker _attachEvents', this._events);
			this._detachEvents();
			this._applyEvents(this._events);
		},
		_detachEvents: function () {
			this._unapplyEvents(this._events);
		},
		_attachSecondaryEvents: function () {
			this._detachSecondaryEvents();
			this._applyEvents(this._secondaryEvents);
		},
		_detachSecondaryEvents: function () {
			this._unapplyEvents(this._secondaryEvents);
		},

		show: function (e) {
			//console.warn('datepicker show', e);
			//if (!this.isInline)
			//	this.picker.appendTo(this.element);
			//console.warn('show', this.picker);
			this.picker.show();
			this.height = this.component ? this.component.outerHeight() : this.element.outerHeight();
			//this.place();
			this._attachSecondaryEvents();
			if (e) {
				e.preventDefault();
			}
			this.element.trigger({
				type: 'show',
				date: this.date
			});
			this.element.blur();
		},

		hide: function (e) {
			if (this.isInline) return;
			if (!this.picker.is(':visible')) return;
			this.picker.hide();//.detach();
			this._detachSecondaryEvents();
			this.viewMode = this.startViewMode;
			this.showMode();

			if (
				this.forceParse &&
				(
					this.isInput && this.element.val() ||
					this.hasInput && this.element.find('input').val()
				)
			)
				this.setValue();
			this.element.trigger({
				type: 'hide',
				date: this.date
			});
		},

		toggle: function (e) {
			console.warn('Datepicker TOGGLE from', this.isOpen, 'to', !this.isOpen);
			if (this.isOpen) {
				this.hide(e);
				this.isOpen = false;
			} else {
				this.show(e);
				this.isOpen = true;
			}
		},

		remove: function () {
			this.hide();
			this._detachEvents();
			this._detachSecondaryEvents();
			this.picker.remove();
			delete this.element.data().datepicker;
			if (!this.isInput) {
				delete this.element.data().date;
			}
		},

		getDate: function () {
			var d = this.getUTCDate();
			return new Date(d.getTime() + (d.getTimezoneOffset() * 60000));
		},

		getUTCDate: function () {
			return this.date;
		},

		setDate: function (d) {
			this.setUTCDate(new Date(d.getTime() - (d.getTimezoneOffset() * 60000)));
		},

		setUTCDate: function (d) {
			this.date = d;
			this.setValue();
		},

		setValue: function () {
			var formatted = this.getFormattedDate();
			if (!this.isInput) {
				if (this.component) {
					this.element.find('input').val(formatted);
				}
			} else {
				this.element.val(formatted);
			}
		},

		getFormattedDate: function (format) {
			if (format === undefined)
				format = this.format;
			return DPGlobal.formatDate(this.date, format, this.language);
		},

		setStartDate: function (startDate) {
			this.startDate = startDate || -Infinity;
			if (this.startDate !== -Infinity) {
				this.startDate = DPGlobal.parseDate(this.startDate, this.format, this.language);
			}
			this.update();
			this.updateNavArrows();
		},

		setEndDate: function (endDate) {
			this.endDate = endDate || Infinity;
			if (this.endDate !== Infinity) {
				this.endDate = DPGlobal.parseDate(this.endDate, this.format, this.language);
			}
			this.update();
			this.updateNavArrows();
		},

		setDaysOfWeekDisabled: function (daysOfWeekDisabled) {
			this.daysOfWeekDisabled = daysOfWeekDisabled || [];
			if (!$.isArray(this.daysOfWeekDisabled)) {
				this.daysOfWeekDisabled = this.daysOfWeekDisabled.split(/,\s*/);
			}
			this.daysOfWeekDisabled = $.map(this.daysOfWeekDisabled, function (d) {
				return parseInt(d, 10);
			});
			this.update();
			this.updateNavArrows();
		},

		place: function () {
			if (this.isInline) return;
			var zIndex = parseInt(this.element.parents().filter(function () {
				return $(this).css('z-index') != 'auto';
			}).first().css('z-index')) + 10;
			var offset = this.component ? this.component.parent().offset() : this.element.offset();
			var height = this.component ? this.component.outerHeight(true) : this.element.outerHeight(true);
			this.picker.css({
				top: offset.top + height,
				left: offset.left,
				zIndex: zIndex
			});
		},

		_allow_update: true,
		update: function () {
			if (!this._allow_update) return;

			var date, fromArgs = false;
			if (arguments && arguments.length && (typeof arguments[0] === 'string' || arguments[0] instanceof Date)) {
				date = arguments[0];
				fromArgs = true;
			} else {
				date = this.isInput ? this.element.val() : this.element.data('date') || this.element.find('input').val();
				delete this.element.data().date;
			}

			this.date = DPGlobal.parseDate(date, this.format, this.language);

			if (fromArgs) this.setValue();

			if (this.date < this.startDate) {
				this.viewDate = new Date(this.startDate);
			} else if (this.date > this.endDate) {
				this.viewDate = new Date(this.endDate);
			} else {
				this.viewDate = new Date(this.date);
			}
			this.fill();
		},

		fillDow: function () {
			var dowCnt = this.weekStart,
			html = '<tr>';
			if (this.calendarWeeks) {
				var cell = '<th class="cw">&nbsp;</th>';
				html += cell;
				this.picker.find('.datepicker-days thead tr:first-child').prepend(cell);
			}
			while (dowCnt < this.weekStart + 7) {
				html += '<th class="dow">' + dates[this.language].daysMin[(dowCnt++) % 7] + '</th>';
			}
			html += '</tr>';
			this.picker.find('.datepicker-days thead').append(html);
		},

		fillMonths: function () {
			var html = '',
			i = 0;
			while (i < 12) {
				html += '<span class="month">' + dates[this.language].monthsShort[i++] + '</span>';
			}
			this.picker.find('.datepicker-months td').html(html);
		},

		setRange: function (range) {
			if (!range || !range.length)
				delete this.range;
			else
				this.range = $.map(range, function (d) { return d.valueOf(); });
			this.fill();
		},

		getClassNames: function (date) {
			var cls = [],
				year = this.viewDate.getUTCFullYear(),
				month = this.viewDate.getUTCMonth(),
				currentDate = this.date.valueOf(),
				today = new Date();
			if (date.getUTCFullYear() < year || (date.getUTCFullYear() == year && date.getUTCMonth() < month)) {
				cls.push('old');
			} else if (date.getUTCFullYear() > year || (date.getUTCFullYear() == year && date.getUTCMonth() > month)) {
				cls.push('new');
			}
			// Compare internal UTC date with local today, not UTC today
			if (this.todayHighlight &&
				date.getUTCFullYear() == today.getFullYear() &&
				date.getUTCMonth() == today.getMonth() &&
				date.getUTCDate() == today.getDate()) {
				cls.push('today');
			}
			if (currentDate && date.valueOf() == currentDate) {
				cls.push('active');
			}
			if (date.valueOf() < this.startDate || date.valueOf() > this.endDate ||
				$.inArray(date.getUTCDay(), this.daysOfWeekDisabled) !== -1) {
				cls.push('disabled');
			}
			if (this.range) {
				if (date > this.range[0] && date < this.range[this.range.length - 1]) {
					cls.push('range');
				}
				if ($.inArray(date.valueOf(), this.range) != -1) {
					cls.push('selected');
				}
			}
			return cls;
		},

		fill: function () {
			var d = new Date(this.viewDate),
				year = d.getUTCFullYear(),
				month = d.getUTCMonth(),
				startYear = this.startDate !== -Infinity ? this.startDate.getUTCFullYear() : -Infinity,
				startMonth = this.startDate !== -Infinity ? this.startDate.getUTCMonth() : -Infinity,
				endYear = this.endDate !== Infinity ? this.endDate.getUTCFullYear() : Infinity,
				endMonth = this.endDate !== Infinity ? this.endDate.getUTCMonth() : Infinity,
				currentDate = this.date && this.date.valueOf();
			this.picker.find('.datepicker-days thead th.datepicker-switch')
						.text(dates[this.language].months[month] + ' ' + year);
			this.picker.find('tfoot th.today')
						.text(dates[this.language].today)
						.toggle(this.todayBtn !== false);
			this.updateNavArrows();
			this.fillMonths();
			var prevMonth = UTCDate(year, month - 1, 28, 0, 0, 0, 0),
				day = DPGlobal.getDaysInMonth(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth());
			prevMonth.setUTCDate(day);
			prevMonth.setUTCDate(day - (prevMonth.getUTCDay() - this.weekStart + 7) % 7);
			var nextMonth = new Date(prevMonth);
			nextMonth.setUTCDate(nextMonth.getUTCDate() + 42);
			nextMonth = nextMonth.valueOf();
			var html = [];
			var clsName;
			while (prevMonth.valueOf() < nextMonth) {
				if (prevMonth.getUTCDay() == this.weekStart) {
					html.push('<tr>');
					if (this.calendarWeeks) {
						// ISO 8601: First week contains first thursday.
						// ISO also states week starts on Monday, but we can be more abstract here.
						var
							// Start of current week: based on weekstart/current date
							ws = new Date(+prevMonth + (this.weekStart - prevMonth.getUTCDay() - 7) % 7 * 864e5),
							// Thursday of this week
							th = new Date(+ws + (7 + 4 - ws.getUTCDay()) % 7 * 864e5),
							// First Thursday of year, year from thursday
							yth = new Date(+(yth = UTCDate(th.getUTCFullYear(), 0, 1)) + (7 + 4 - yth.getUTCDay()) % 7 * 864e5),
							// Calendar week: ms between thursdays, div ms per day, div 7 days
							calWeek = (th - yth) / 864e5 / 7 + 1;
						html.push('<td class="cw">' + calWeek + '</td>');

					}
				}
				clsName = this.getClassNames(prevMonth);
				clsName.push('day');
				html.push('<td class="' + clsName.join(' ') + '">' + prevMonth.getUTCDate() + '</td>');
				if (prevMonth.getUTCDay() == this.weekEnd) {
					html.push('</tr>');
				}
				prevMonth.setUTCDate(prevMonth.getUTCDate() + 1);
			}
			this.picker.find('.datepicker-days tbody').empty().append(html.join(''));
			var currentYear = this.date && this.date.getUTCFullYear();

			var months = this.picker.find('.datepicker-months')
						.find('th:eq(1)')
							.text(year)
							.end()
						.find('span').removeClass('active');
			if (currentYear && currentYear == year) {
				months.eq(this.date.getUTCMonth()).addClass('active');
			}
			if (year < startYear || year > endYear) {
				months.addClass('disabled');
			}
			if (year == startYear) {
				months.slice(0, startMonth).addClass('disabled');
			}
			if (year == endYear) {
				months.slice(endMonth + 1).addClass('disabled');
			}

			html = '';
			year = parseInt(year / 10, 10) * 10;
			var yearCont = this.picker.find('.datepicker-years')
								.find('th:eq(1)')
									.text(year + '-' + (year + 9))
									.end()
								.find('td');
			year -= 1;
			for (var i = -1; i < 11; i++) {
				html += '<span class="year' + (i == -1 || i == 10 ? ' old' : '') + (currentYear == year ? ' active' : '') + (year < startYear || year > endYear ? ' disabled' : '') + '">' + year + '</span>';
				year += 1;
			}
			yearCont.html(html);
		},

		updateNavArrows: function () {
			if (!this._allow_update) return;

			var d = new Date(this.viewDate),
				year = d.getUTCFullYear(),
				month = d.getUTCMonth();
			switch (this.viewMode) {
				case 0:
					if (this.startDate !== -Infinity && year <= this.startDate.getUTCFullYear() && month <= this.startDate.getUTCMonth()) {
						this.picker.find('.prev').css({ visibility: 'hidden' });
					} else {
						this.picker.find('.prev').css({ visibility: 'visible' });
					}
					if (this.endDate !== Infinity && year >= this.endDate.getUTCFullYear() && month >= this.endDate.getUTCMonth()) {
						this.picker.find('.next').css({ visibility: 'hidden' });
					} else {
						this.picker.find('.next').css({ visibility: 'visible' });
					}
					break;
				case 1:
				case 2:
					if (this.startDate !== -Infinity && year <= this.startDate.getUTCFullYear()) {
						this.picker.find('.prev').css({ visibility: 'hidden' });
					} else {
						this.picker.find('.prev').css({ visibility: 'visible' });
					}
					if (this.endDate !== Infinity && year >= this.endDate.getUTCFullYear()) {
						this.picker.find('.next').css({ visibility: 'hidden' });
					} else {
						this.picker.find('.next').css({ visibility: 'visible' });
					}
					break;
			}
		},

		click: function (e) {
			console.log("clicked datepicker!!!!!");
			e.preventDefault();
			var target = $(e.target).closest('span, td, th');
			if (target.length == 1) {
				switch (target[0].nodeName.toLowerCase()) {
					case 'th':
						switch (target[0].className) {
							case 'datepicker-switch':
								this.showMode(1);
								break;
							case 'prev':
							case 'next':
								var dir = DPGlobal.modes[this.viewMode].navStep * (target[0].className == 'prev' ? -1 : 1);
								switch (this.viewMode) {
									case 0:
										this.viewDate = this.moveMonth(this.viewDate, dir);
										break;
									case 1:
									case 2:
										this.viewDate = this.moveYear(this.viewDate, dir);
										break;
								}
								this.fill();
								break;
							case 'today':
								var date = new Date();
								date = UTCDate(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);

								this.showMode(-2);
								var which = this.todayBtn == 'linked' ? null : 'view';
								this._setDate(date, which);
								break;
						}
						break;
					case 'span':
						if (!target.is('.disabled')) {
							this.viewDate.setUTCDate(1);
							if (target.is('.month')) {
								var day = 1;
								var month = target.parent().find('span').index(target);
								var year = this.viewDate.getUTCFullYear();
								this.viewDate.setUTCMonth(month);
								this.element.trigger({
									type: 'changeMonth',
									date: this.viewDate
								});
								if (this.minViewMode == 1) {
									this._setDate(UTCDate(year, month, day, 0, 0, 0, 0));
								}
							} else {
								var year = parseInt(target.text(), 10) || 0;
								var day = 1;
								var month = 0;
								this.viewDate.setUTCFullYear(year);
								this.element.trigger({
									type: 'changeYear',
									date: this.viewDate
								});
								if (this.minViewMode == 2) {
									this._setDate(UTCDate(year, month, day, 0, 0, 0, 0));
								}
							}
							this.showMode(-1);
							this.fill();
						}
						break;
					case 'td':
						if (target.is('.day') && !target.is('.disabled')) {
							var day = parseInt(target.text(), 10) || 1;
							var year = this.viewDate.getUTCFullYear(),
								month = this.viewDate.getUTCMonth();
							if (target.is('.old')) {
								if (month === 0) {
									month = 11;
									year -= 1;
								} else {
									month -= 1;
								}
							} else if (target.is('.new')) {
								if (month == 11) {
									month = 0;
									year += 1;
								} else {
									month += 1;
								}
							}
							this._setDate(UTCDate(year, month, day, 0, 0, 0, 0));
						}
						break;
				}
			}
		},

		_setDate: function (date, which) {
			if (!which || which == 'date')
				this.date = date;
			if (!which || which == 'view')
				this.viewDate = date;
			this.fill();
			this.setValue();
			this.element.trigger({
				type: 'changeDate',
				date: this.date
			});
			var element;
			if (this.isInput) {
				element = this.element;
			} else if (this.component) {
				element = this.element.find('input');
			}
			if (element) {
				element.change();
				if (this.autoclose && (!which || which == 'date')) {
					this.hide();
				}
			}
		},

		moveMonth: function (date, dir) {
			if (!dir) return date;
			var new_date = new Date(date.valueOf()),
				day = new_date.getUTCDate(),
				month = new_date.getUTCMonth(),
				mag = Math.abs(dir),
				new_month, test;
			dir = dir > 0 ? 1 : -1;
			if (mag == 1) {
				test = dir == -1
					// If going back one month, make sure month is not current month
					// (eg, Mar 31 -> Feb 31 == Feb 28, not Mar 02)
					? function () { return new_date.getUTCMonth() == month; }
					// If going forward one month, make sure month is as expected
					// (eg, Jan 31 -> Feb 31 == Feb 28, not Mar 02)
					: function () { return new_date.getUTCMonth() != new_month; };
				new_month = month + dir;
				new_date.setUTCMonth(new_month);
				// Dec -> Jan (12) or Jan -> Dec (-1) -- limit expected date to 0-11
				if (new_month < 0 || new_month > 11)
					new_month = (new_month + 12) % 12;
			} else {
				// For magnitudes >1, move one month at a time...
				for (var i = 0; i < mag; i++)
					// ...which might decrease the day (eg, Jan 31 to Feb 28, etc)...
					new_date = this.moveMonth(new_date, dir);
				// ...then reset the day, keeping it in the new month
				new_month = new_date.getUTCMonth();
				new_date.setUTCDate(day);
				test = function () { return new_month != new_date.getUTCMonth(); };
			}
			// Common date-resetting loop -- if date is beyond end of month, make it
			// end of month
			while (test()) {
				new_date.setUTCDate(--day);
				new_date.setUTCMonth(new_month);
			}
			return new_date;
		},

		moveYear: function (date, dir) {
			return this.moveMonth(date, dir * 12);
		},

		dateWithinRange: function (date) {
			return date >= this.startDate && date <= this.endDate;
		},

		keydown: function (e) {
			if (this.picker.is(':not(:visible)')) {
				if (e.keyCode == 27) // allow escape to hide and re-show picker
					this.show();
				return;
			}
			var dateChanged = false,
				dir, day, month,
				newDate, newViewDate;
			switch (e.keyCode) {
				case 27: // escape
					this.hide();
					e.preventDefault();
					break;
				case 37: // left
				case 39: // right
					if (!this.keyboardNavigation) break;
					dir = e.keyCode == 37 ? -1 : 1;
					if (e.ctrlKey) {
						newDate = this.moveYear(this.date, dir);
						newViewDate = this.moveYear(this.viewDate, dir);
					} else if (e.shiftKey) {
						newDate = this.moveMonth(this.date, dir);
						newViewDate = this.moveMonth(this.viewDate, dir);
					} else {
						newDate = new Date(this.date);
						newDate.setUTCDate(this.date.getUTCDate() + dir);
						newViewDate = new Date(this.viewDate);
						newViewDate.setUTCDate(this.viewDate.getUTCDate() + dir);
					}
					if (this.dateWithinRange(newDate)) {
						this.date = newDate;
						this.viewDate = newViewDate;
						this.setValue();
						this.update();
						e.preventDefault();
						dateChanged = true;
					}
					break;
				case 38: // up
				case 40: // down
					if (!this.keyboardNavigation) break;
					dir = e.keyCode == 38 ? -1 : 1;
					if (e.ctrlKey) {
						newDate = this.moveYear(this.date, dir);
						newViewDate = this.moveYear(this.viewDate, dir);
					} else if (e.shiftKey) {
						newDate = this.moveMonth(this.date, dir);
						newViewDate = this.moveMonth(this.viewDate, dir);
					} else {
						newDate = new Date(this.date);
						newDate.setUTCDate(this.date.getUTCDate() + dir * 7);
						newViewDate = new Date(this.viewDate);
						newViewDate.setUTCDate(this.viewDate.getUTCDate() + dir * 7);
					}
					if (this.dateWithinRange(newDate)) {
						this.date = newDate;
						this.viewDate = newViewDate;
						this.setValue();
						this.update();
						e.preventDefault();
						dateChanged = true;
					}
					break;
				case 13: // enter
					this.hide();
					e.preventDefault();
					break;
				case 9: // tab
					this.hide();
					break;
			}
			if (dateChanged) {
				this.element.trigger({
					type: 'changeDate',
					date: this.date
				});
				var element;
				if (this.isInput) {
					element = this.element;
				} else if (this.component) {
					element = this.element.find('input');
				}
				if (element) {
					element.change();
				}
			}
		},

		showMode: function (dir) {
			if (dir) {
				this.viewMode = Math.max(this.minViewMode, Math.min(2, this.viewMode + dir));
			}
			/*
				vitalets: fixing bug of very special conditions:
				jquery 1.7.1 + webkit + show inline datepicker in bootstrap popover.
				Method show() does not set display css correctly and datepicker is not shown.
				Changed to .css('display', 'block') solve the problem.
				See https://github.com/vitalets/x-editable/issues/37

				In jquery 1.7.2+ everything works fine.
			*/
			//this.picker.find('>div').hide().filter('.datepicker-'+DPGlobal.modes[this.viewMode].clsName).show();
			this.picker.find('>div').hide().filter('.datepicker-' + DPGlobal.modes[this.viewMode].clsName).css('display', 'block');
			this.updateNavArrows();
		}
	};

	var DateRangePicker = function (element, options) {
		this.element = $(element);
		this.inputs = $.map(options.inputs, function (i) { return i.jquery ? i[0] : i; });
		delete options.inputs;

		$(this.inputs)
			.datepicker(options)
			.bind('changeDate', $.proxy(this.dateUpdated, this));

		this.pickers = $.map(this.inputs, function (i) { return $(i).data('datepicker'); });
		this.updateDates();
	};
	DateRangePicker.prototype = {
		updateDates: function () {
			this.dates = $.map(this.pickers, function (i) { return i.date; });
			this.updateRanges();
		},
		updateRanges: function () {
			var range = $.map(this.dates, function (d) { return d.valueOf(); });
			$.each(this.pickers, function (i, p) {
				p.setRange(range);
			});
		},
		dateUpdated: function (e) {
			var dp = $(e.target).data('datepicker'),
				new_date = e.date,
				i = $.inArray(e.target, this.inputs),
				l = this.inputs.length;
			if (i == -1) return;

			if (new_date < this.dates[i]) {
				// Date being moved earlier/left
				while (i >= 0 && new_date < this.dates[i]) {
					this.pickers[i--].setUTCDate(new_date);
				}
			}
			else if (new_date > this.dates[i]) {
				// Date being moved later/right
				while (i < l && new_date > this.dates[i]) {
					this.pickers[i++].setUTCDate(new_date);
				}
			}
			this.updateDates();
		},
		remove: function () {
			$.map(this.pickers, function (p) { p.remove(); });
			delete this.element.data().datepicker;
		}
	};

	var old = $.fn.datepicker;
	$.fn.datepicker = function (option) {
		var args = Array.apply(null, arguments);
		args.shift();
		return this.each(function () {
			var $this = $(this),
				data = $this.data('datepicker'),
				options = typeof option == 'object' && option;
			if (!data) {
				if ($this.is('.input-daterange') || options.inputs) {
					var opts = {
						inputs: options.inputs || $this.find('input').toArray()
					};
					$this.data('datepicker', (data = new DateRangePicker(this, $.extend(opts, $.fn.datepicker.defaults, options))));
				}
				else {
					$this.data('datepicker', (data = new Datepicker(this, $.extend({}, $.fn.datepicker.defaults, options))));
				}
			}
			if (typeof option == 'string' && typeof data[option] == 'function') {
				data[option].apply(data, args);
			}
		});
	};

	$.fn.datepicker.defaults = {
	};
	$.fn.datepicker.Constructor = Datepicker;
	var dates = $.fn.datepicker.dates = {
		en: {
			days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
			daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
			daysMin: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
			months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
			monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
			today: "Today"
		}
	};

	var DPGlobal = {
		modes: [
			{
				clsName: 'days',
				navFnc: 'Month',
				navStep: 1
			},
			{
				clsName: 'months',
				navFnc: 'FullYear',
				navStep: 1
			},
			{
				clsName: 'years',
				navFnc: 'FullYear',
				navStep: 10
			}],
		isLeapYear: function (year) {
			return (((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0));
		},
		getDaysInMonth: function (year, month) {
			return [31, (DPGlobal.isLeapYear(year) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
		},
		validParts: /dd?|DD?|mm?|MM?|yy(?:yy)?/g,
		nonpunctuation: /[^ -\/:-@\[\u3400-\u9fff-`{-~\t\n\r]+/g,
		parseFormat: function (format) {
			// IE treats \0 as a string end in inputs (truncating the value),
			// so it's a bad format delimiter, anyway
			var separators = format.replace(this.validParts, '\0').split('\0'),
				parts = format.match(this.validParts);
			if (!separators || !separators.length || !parts || parts.length === 0) {
				throw new Error("Invalid date format.");
			}
			return { separators: separators, parts: parts };
		},
		parseDate: function (date, format, language) {
			if (date instanceof Date) return date;
			if (/^[\-+]\d+[dmwy]([\s,]+[\-+]\d+[dmwy])*$/.test(date)) {
				var part_re = /([\-+]\d+)([dmwy])/,
					parts = date.match(/([\-+]\d+)([dmwy])/g),
					part, dir;
				date = new Date();
				for (var i = 0; i < parts.length; i++) {
					part = part_re.exec(parts[i]);
					dir = parseInt(part[1]);
					switch (part[2]) {
						case 'd':
							date.setUTCDate(date.getUTCDate() + dir);
							break;
						case 'm':
							date = Datepicker.prototype.moveMonth.call(Datepicker.prototype, date, dir);
							break;
						case 'w':
							date.setUTCDate(date.getUTCDate() + dir * 7);
							break;
						case 'y':
							date = Datepicker.prototype.moveYear.call(Datepicker.prototype, date, dir);
							break;
					}
				}
				return UTCDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0);
			}
			var parts = date && date.match(this.nonpunctuation) || [],
				date = new Date(),
				parsed = {},
				setters_order = ['yyyy', 'yy', 'M', 'MM', 'm', 'mm', 'd', 'dd'],
				setters_map = {
					yyyy: function (d, v) { return d.setUTCFullYear(v); },
					yy: function (d, v) { return d.setUTCFullYear(2000 + v); },
					m: function (d, v) {
						v -= 1;
						while (v < 0) v += 12;
						v %= 12;
						d.setUTCMonth(v);
						while (d.getUTCMonth() != v)
							d.setUTCDate(d.getUTCDate() - 1);
						return d;
					},
					d: function (d, v) { return d.setUTCDate(v); }
				},
				val, filtered, part;
			setters_map['M'] = setters_map['MM'] = setters_map['mm'] = setters_map['m'];
			setters_map['dd'] = setters_map['d'];
			date = UTCDate(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
			var fparts = format.parts.slice();
			// Remove noop parts
			if (parts.length != fparts.length) {
				fparts = $(fparts).filter(function (i, p) {
					return $.inArray(p, setters_order) !== -1;
				}).toArray();
			}
			// Process remainder
			if (parts.length == fparts.length) {
				for (var i = 0, cnt = fparts.length; i < cnt; i++) {
					val = parseInt(parts[i], 10);
					part = fparts[i];
					if (isNaN(val)) {
						switch (part) {
							case 'MM':
								filtered = $(dates[language].months).filter(function () {
									var m = this.slice(0, parts[i].length),
										p = parts[i].slice(0, m.length);
									return m == p;
								});
								val = $.inArray(filtered[0], dates[language].months) + 1;
								break;
							case 'M':
								filtered = $(dates[language].monthsShort).filter(function () {
									var m = this.slice(0, parts[i].length),
										p = parts[i].slice(0, m.length);
									return m == p;
								});
								val = $.inArray(filtered[0], dates[language].monthsShort) + 1;
								break;
						}
					}
					parsed[part] = val;
				}
				for (var i = 0, s; i < setters_order.length; i++) {
					s = setters_order[i];
					if (s in parsed && !isNaN(parsed[s]))
						setters_map[s](date, parsed[s]);
				}
			}
			return date;
		},
		formatDate: function (date, format, language) {
			var val = {
				//WARN: it used to be date.getUTCDate() but was causing MAJOR issue because of the timezone the date was 1 day behind
				d: date.getDate(),
				D: dates[language].daysShort[date.getUTCDay()],
				DD: dates[language].days[date.getUTCDay()],
				m: date.getUTCMonth() + 1,
				M: dates[language].monthsShort[date.getUTCMonth()],
				MM: dates[language].months[date.getUTCMonth()],
				yy: date.getUTCFullYear().toString().substring(2),
				yyyy: date.getUTCFullYear()
			};
			val.dd = (val.d < 10 ? '0' : '') + val.d;
			val.mm = (val.m < 10 ? '0' : '') + val.m;
			var date = [],
				seps = $.extend([], format.separators);
			for (var i = 0, cnt = format.parts.length; i < cnt; i++) {
				if (seps.length)
					date.push(seps.shift());
				date.push(val[format.parts[i]]);
			}
			return date.join('');
		},
		headTemplate: '<thead>' +
							'<tr>' +
								'<th class="prev"><i class="glyphicon glyphicon-arrow-left"/></th>' +
								'<th colspan="5" class="datepicker-switch"></th>' +
								'<th class="next"><i class="glyphicon glyphicon-arrow-right"/></th>' +
							'</tr>' +
						'</thead>',
		contTemplate: '<tbody><tr><td colspan="7"></td></tr></tbody>',
		footTemplate: '<tfoot><tr><th colspan="7" class="today"></th></tr></tfoot>'
	};
	DPGlobal.template = '<div class="datepicker">' +
							'<div class="datepicker-days">' +
								'<table class=" table-condensed">' +
									DPGlobal.headTemplate +
									'<tbody></tbody>' +
									DPGlobal.footTemplate +
								'</table>' +
							'</div>' +
							'<div class="datepicker-months">' +
								'<table class="table-condensed">' +
									DPGlobal.headTemplate +
									DPGlobal.contTemplate +
									DPGlobal.footTemplate +
								'</table>' +
							'</div>' +
							'<div class="datepicker-years">' +
								'<table class="table-condensed">' +
									DPGlobal.headTemplate +
									DPGlobal.contTemplate +
									DPGlobal.footTemplate +
								'</table>' +
							'</div>' +
						'</div>';

	$.fn.datepicker.DPGlobal = DPGlobal;


	/* DATEPICKER NO CONFLICT
	* =================== */

	$.fn.datepicker.noConflict = function () {
		$.fn.datepicker = old;
		return this;
	};


	/* DATEPICKER DATA-API
	* ================== */

	$(document).on(
		'focus.datepicker.data-api click.datepicker.data-api',
		'[data-provide="datepicker"]',
		function (e) {
			var $this = $(this);
			if ($this.data('datepicker')) return;
			e.preventDefault();
			// component click requires us to explicitly show it
			$this.datepicker('show');
		}
	);
	$(function () {
		$('[data-provide="datepicker-inline"]').datepicker();
	});

}(window.jQuery);
window.define && define("bootstrap-datepicker", [
], function () {
	return $.fn.datepicker;
});

//# sourceMappingURL=vendor.js.map