var Repo = require('nodegit').Repo,
	Promise = require('promise'),
	fs = require('fs'),
	path = require('path'),
	EventEmitter = require('events').EventEmitter;

module.exports = GitWatch;
GitWatch.walkCommit = walkCommit;

/**
 * `git log`-like function.
 * Takes callback : (commit: Commit, next: () -> void) -> void
 * Callback gets invoked for each commit while next() is called in callback
 */
function walkCommit(repo, commit, callback) {
	var rv = repo.createRevWalk();
	rv.push(commit.oid(), function() {
		next();

		function walk(err, oid) {
			if(err) throw err;
			if(oid) {
				repo.getCommit(oid, function(err, commit) {
					if(err) throw err;
					callback(commit, next);
				});
			} else {
				callback();
			}
		}
		function next() {
			rv.next(walk);
		}
	});
}

function GitWatch(dir) {
	this.master = null;
	this.headRef = null;
	this.refs = {};
	openRepo.call(this, dir);
}

GitWatch.prototype = Object.create(EventEmitter.prototype);

function createWatcher(refname) {
	try {
		fs.watch(path.join(this.repo.path(), refname),
				function(event, filename) {
			if(event == 'change') {
				refChanged.call(this, refname);
			}
		}.bind(this));
	} catch(e) {
		this.emit('error', e);
	}
}

function refChanged(refname) {
	var self = this;

	var oldMaster = self.refs[refname];
	var newCommits = [];
	self.repo.getReference(refname, function(err, ref) {
		if(err) throw err;
		self.repo.getCommit(ref.target(), function(err, master) {
			if(err) throw err;
			self.refs[refname] = master.sha();
			self.emit('refChanged', refname, self.refs[refname], oldMaster);
			walkCommit(self.repo, master, function(commit, next) {
				if(!commit && oldMaster) {
					// don't emit any events; commits deleted
					createWatcher.call(self, refname);
				} else if(!commit || commit.sha() == oldMaster) {
					if(newCommits.length)
						self.emit('newCommits', newCommits, refname);
					createWatcher.call(self, refname);
				} else {
					newCommits.push(commit);
					next();
				}
			});
		});
	});
}

function openRepo(dir) {
	var self = this;

	// This code sucks.
	Repo.open(dir, function(err, repo) {
		if(err) { self.emit('error', err); return; }
		self.repo = repo;
		repo.getReference('HEAD', function(err, ref) {
			if(err) { self.emit('error', err); return; }
			ref.resolve(function(err, realRef) {
				var refname = realRef.name();
				self.headRef = refname;
				repo.getCommit(realRef.target(), function(err, headCommit) {
					self.refs[refname] = headCommit.sha();
					createWatcher.call(self, refname);
					self.emit('open');
				});
			});
		});
	});
}
