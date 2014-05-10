var ws = require('ws'),
	path = require('path'),
	fs = require('fs'),
	async = require('async'),
	GitWatch = require('./lib/git-watch'),
	static = require('node-static'),
	http = require('http'),
	ejs = require('ejs'),
	EventEmitter = require('events').EventEmitter;

var config = require('./config');
config.commitListSize = config.commitListSize || 100;
config.commitsPerRepo = config.commitsPerRepo || 50;

var exclude = [ 'build', 'bin', 'classes', 'src', 'photos' ];

var repos = {};

// Find the damn repos
function traverse(basedir, dir, prefix, callback) {
	fs.readdir(path.join(basedir, dir), function(err, files) {
		if(err) { callback(null, []); return; } // ignore
		if(files.indexOf('HEAD') != -1 && files.indexOf('config') != -1) {
			var base = dir.replace(/\/?\.git$/, '');
			var repoName = path.join(prefix, base);
			console.log('Found repo: ' + repoName);
			repos[repoName] = new GitWatch(path.join(basedir, dir));
			numRepos++;
			repos[repoName].addListener('open', function() {
				numOpened++;
				if(finished && numRepos == numOpened) {
					readInitialCommits();
				}
			});
			repos[repoName].addListener('error', function(err) {
				repos[repoName].error = true;
				console.log(repoName + ": " + err.toString());
				numOpened++;
				if(finished && numRepos == numOpened) {
					readInitialCommits();
				}
			});
			callback(null, []);
		} else {
			async.map(files, function(file, callback) {
				if(file == '.git' || file[0] != '.' && exclude.indexOf(file) == -1)
					traverse(basedir, path.join(dir, file), prefix, callback);
				else
					callback(null, []);
			}, function(err, results) {
				if(err) throw err;
				callback(null, Array.prototype.concat.apply([], results));
			});
		}
	});
}


function readInitialCommits() {
	console.log('Reading commits...');
	async.map(Object.keys(repos), function(name, callback) {
		if(repos[name].error) { callback(null, []); return; }
		var repo = repos[name].repo;
		repo.getReference(repos[name].headRef, function(err, ref) {
			if(err) throw err;
			repo.getCommit(ref.target(), function(err, master) {
				if(err) throw err;
				var clist = [];
				var counter = 0;
				GitWatch.walkCommit(repo, master, function(commit, next) {
					if(!commit || counter == config.commitsPerRepo) {
						callback(null, clist);
					} else {
						counter++;
						clist.push(formatCommit(name, commit));
						next();
					}
				});
			});
		});
	}, function(err, lists) {
		if(err) throw err;
		var list = Array.prototype.concat.apply([], lists);
		list.sort(function(a, b) {
			var d1 = new Date(a.date);
			var d2 = new Date(b.date);
			return d1>d2?1:d1<d2?-1:0;
		});
		if(list.length > config.commitListSize)
			list.splice(0, config.commitListSize);
		feed = list;
		startHHTP();
		startWS();
	});
}

var numRepos = 0, numOpened = 0, finished = false;

async.map(Object.keys(config.dirs), function(name, callback) {
	traverse(config.dirs[name], '', name, callback);
}, function() {
	finished = true;
	if(numRepos == numOpened) {
		readInitialCommits();
	}

	Object.keys(repos).forEach(function(name) {
		repos[name].addListener('newCommits', function(newCommits) {
			emitCommits(name, newCommits);
		});
	});
});

function emitCommits(repo, newCommits) {
	for(var i =  newCommits.length-1; i >= 0; i--) {
		var commit = newCommits[i];
		pushCommit(formatCommit(repo, commit));
	}
}

function pushCommit(commit) {
	if(feed.length == config.commitListSize)
		delete feed[0]; // FIXME grossly inefficient!
	feed.push(commit);
	ee.emit('newCommit', commit);
}

function formatCommit(repo, commit) {
	return { repo: repo, sha: commit.sha(),
				author: commit.author().toString(),
				committer: commit.committer().toString(),
				date: commit.date().toString(),
				message: commit.message().split('\n')[0].trim() };
}

var ee = new EventEmitter();
ee.setMaxListeners(0);

var feed = [];

function startWS() {
	var nextWsId = 1;
	var wss = new ws.Server({ server: httpServer });
	wss.on('connection', function(ws) {
		var id = nextWsId++;
		console.log('CONNECT ' + id);
		function onNewCommit(newCommit) {
			ws.send(JSON.stringify(newCommit));
		}

		function subscribe() {
			ee.addListener('newCommit', onNewCommit);
			subscribe = function() {};
		}

		ws.on('message', function(data) {
			var last_sha = data;
			var index = feed.length - 1;
			while(index >= 0 && feed[index].sha != last_sha)
				index--;
			index++;
			for(; index < feed.length; index++) {
				onNewCommit(feed[index]);
			}
			subscribe();
		});

		function unsubscribe() {
			ee.removeListener('newCommit', onNewCommit);
		}

		ws.on('close', function() {
			console.log('CLOSE ' + id);
			unsubscribe();
		});
		ws.on('error', function() {
			console.log('ERROR ' + id);
			unsubscribe();
		});
	});
	console.log('OK, started.');
}

function loadTemplate(name) {
	return ejs.compile(fs.readFileSync(require.resolve(name), 'utf-8'));
}

function startHHTP() {
	var fileServer = new static.Server('./frontend');
	var index = loadTemplate('./templates/index.ejs');
	var commitTemplate = fs.readFileSync(require.resolve('./templates/commit.ejs'), 'utf-8');
	var commitCompiled = ejs.compile(commitTemplate);
	httpServer = http.createServer(function(request, response) {
		if(request.url == '/') {
			var context = {
				config: config,
				commitTemplate: commitTemplate,
				commitTemplateCompiled: commitCompiled,
				commits: feed
			};
			response.end(index(context));
		} else {
			fileServer.serve(request, response);
		}
	});
	httpServer.listen(config.port || 8097);
}
