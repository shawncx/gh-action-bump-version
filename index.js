const { Toolkit } = require('actions-toolkit')
const { execSync } = require('child_process')

// Change working directory if user defined PACKAGEJSON_DIR
if (process.env.PACKAGEJSON_DIR) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`
  process.chdir(process.env.GITHUB_WORKSPACE)
}

// Run your GitHub Action!
Toolkit.run(async tools => {
  console.log('xichen-gh-action-bump-version started.')
  const pkg = tools.getPackageJSON()
  const event = tools.context.payload

  const commitTimeCheckHour = process.env['INPUT_commit-time-check'];
  if (commitTimeCheckHour > 0) {
    console.log(`commitTimeCheckHours is ${commitTimeCheckHour}. Start to check last commit.`);
    const lastCommitDateStr = await tools.runInWorkspace('git', ['log', '-1', '--format=%cd', '--date=iso-strict']);
    console.log(`Get lastCommitDateStr: ${lastCommitDateStr}`);
    const commitDiffInMillisecond = new Date().getTime() - new Date(lastCommitDateStr).getTime();
    const diffInMillisecond = commitTimeCheckHour * 60 * 60 * 1000;
    if (commitDiffInMillisecond >= diffInMillisecond) {
      console.log(`Diff between last commit is bigger than ${commitTimeCheckHour}. Skip version bump!`);
      return;
    } else {
      console.log(`Diff between last commit is smaller than ${commitTimeCheckHour}. Continue version bump!`);
    }
  } else {
    console.log(`commit-time-check is not set! Continue version bump!`);
  }

  const messages = event.commits.map(commit => commit.message + '\n' + commit.body)

  const commitMessage = 'version bump to'
  const isVersionBump = messages.map(message => message.toLowerCase().includes(commitMessage)).includes(true)
  if (isVersionBump) {
    tools.exit.success('No action necessary!')
    return
  }

  let version = 'patch'
  if (messages.map(message => message.includes('BREAKING CHANGE') || message.includes('major')).includes(true)) {
    version = 'major'
  } else if (messages.map(
    message => message.toLowerCase().startsWith('feat') || message.toLowerCase().includes('minor')).includes(true)) {
    version = 'minor'
  }

  try {
    const current = pkg.version.toString()
    // set git user
    await tools.runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Automated Version Bump'}"`])
    await tools.runInWorkspace('git', ['config', 'user.email', `"${process.env.GITHUB_EMAIL || 'gh-action-bump-version@users.noreply.github.com'}"`])

    const currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1]
    console.log('currentBranch:', currentBranch)

    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    await tools.runInWorkspace('npm',
      ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    let newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim()
    await tools.runInWorkspace('git', ['commit', '-a', '-m', `ci: ${commitMessage} ${newVersion}`])

    // now go to the actual branch to perform the same versioning
    await tools.runInWorkspace('git', ['checkout', currentBranch])
    await tools.runInWorkspace('npm',
      ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim()
    newVersion = `${process.env['INPUT_TAG-PREFIX']}${newVersion}`
    console.log('new version:', newVersion)
    try {
      // to support "actions/checkout@v1"
      await tools.runInWorkspace('git', ['commit', '-a', '-m', `ci: ${commitMessage} ${newVersion}`])
    } catch (e) {
      console.warn('git commit failed because you are using "actions/checkout@v2"; ' +
        'but that doesnt matter because you dont need that git commit, thats only for "actions/checkout@v1"')
    }

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`
    // console.log(Buffer.from(remoteRepo).toString('base64'))
    await tools.runInWorkspace('git', ['tag', newVersion])
    await tools.runInWorkspace('git', ['push', remoteRepo, '--follow-tags'])
    await tools.runInWorkspace('git', ['push', remoteRepo, '--tags'])
  } catch (e) {
    tools.log.fatal(e)
    tools.exit.failure('Failed to bump version')
  }
  tools.exit.success('Version bumped!')
})
