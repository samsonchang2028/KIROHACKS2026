'use strict';

const os = require('os');
const { execSync } = require('child_process');

// Demo overrides — set these env vars to fake system state for demos.
// DEMO_UPTIME_DAYS=5  → pretend the computer has been on for 5 days
// DEMO_RAM_USAGE_PCT=90 → pretend 90% of RAM is in use
// DEMO_CPU_USAGE_PCT=90 → pretend 90% CPU usage
const UPTIME_THRESHOLD_DAYS = 3;
const RAM_THRESHOLD_PCT = 85;
const CPU_THRESHOLD_PCT = 80;

// Apps that should never be killed — OS-critical or our own app.
const PROTECTED = [
  'finder', 'systemuiserver', 'dock', 'windowserver', 'loginwindow',
  'kernel_task', 'launchd', 'spotlight', 'coreaudiod', 'electron',
  'senior-assistant', 'node', 'system settings', 'system preferences',
  'explorer', 'dwm', 'csrss', 'svchost', 'taskmgr', 'winlogon',
  'lsass', 'services', 'smss', 'wininit', 'shell experience host',
  'coreservices', 'notificationcenter', 'airplay', 'sharingd',
  'bluetoothd', 'wifi', 'opendirectory', 'mdworker', 'mds',
];

function isProtected(name) {
  const lower = name.toLowerCase();
  return PROTECTED.some(p => lower.includes(p));
}

function checkUptime() {
  const uptimeSec = process.env.DEMO_UPTIME_DAYS
    ? Number(process.env.DEMO_UPTIME_DAYS) * 86400
    : os.uptime();
  const days = Math.floor(uptimeSec / 86400);
  if (days >= UPTIME_THRESHOLD_DAYS) {
    return `Your computer has been on for ${days} days. A restart might help it run better.`;
  }
  return null;
}

function checkMemory() {
  const usedPct = process.env.DEMO_RAM_USAGE_PCT
    ? Number(process.env.DEMO_RAM_USAGE_PCT)
    : ((1 - os.freemem() / os.totalmem()) * 100);
  if (usedPct >= RAM_THRESHOLD_PCT) {
    return `Your memory is ${Math.round(usedPct)}% full. Closing some apps might speed things up.`;
  }
  return null;
}

/**
 * Samples CPU usage over a short interval and returns a suggestion string if
 * usage exceeds CPU_THRESHOLD_PCT, or null if the system is fine.
 * Uses a synchronous 500ms sample on Windows (wmic) and a two-snapshot approach
 * on macOS (ps). Falls back gracefully if the command fails.
 */
function checkCpu() {
  if (process.env.DEMO_CPU_USAGE_PCT) {
    const pct = Number(process.env.DEMO_CPU_USAGE_PCT);
    if (pct >= CPU_THRESHOLD_PCT) {
      return `Your computer's processor is working very hard right now (${Math.round(pct)}% busy). Closing some apps or restarting might help.`;
    }
    return null;
  }

  try {
    let cpuPct = 0;
    if (process.platform === 'darwin') {
      // top -l 2 gives two samples; the second is more accurate
      const raw = execSync('top -l 2 -n 0 | grep "CPU usage"', { encoding: 'utf8', timeout: 6000 });
      const lines = raw.trim().split('\n');
      const last = lines[lines.length - 1];
      const match = last.match(/([\d.]+)%\s+user.*?([\d.]+)%\s+sys/);
      if (match) cpuPct = parseFloat(match[1]) + parseFloat(match[2]);
    } else {
      // wmic returns LoadPercentage for each logical CPU core; average them
      const raw = execSync('wmic cpu get LoadPercentage /value', { encoding: 'utf8', timeout: 5000 });
      const matches = [...raw.matchAll(/LoadPercentage=(\d+)/g)];
      if (matches.length > 0) {
        const sum = matches.reduce((acc, m) => acc + parseInt(m[1], 10), 0);
        cpuPct = sum / matches.length;
      }
    }

    if (cpuPct >= CPU_THRESHOLD_PCT) {
      return `Your computer's processor is working very hard right now (${Math.round(cpuPct)}% busy). Closing some apps or restarting might help.`;
    }
    return null;
  } catch (err) {
    console.error('[system-monitor] checkCpu error:', err.message);
    return null;
  }
}

// Friendly names for common processes — seniors don't know what "com.apple.WebKit" is.
const FRIENDLY_NAMES = {
  'google chrome': 'Google Chrome',
  'google chrome helper': 'Google Chrome',
  'chrome': 'Google Chrome',
  'safari': 'Safari',
  'firefox': 'Firefox',
  'msedge': 'Microsoft Edge',
  'slack': 'Slack',
  'slack helper': 'Slack',
  'slack helper (renderer)': 'Slack',
  'microsoft outlook': 'Outlook',
  'outlook': 'Outlook',
  'spotify': 'Spotify',
  'spotify helper': 'Spotify',
  'discord': 'Discord',
  'zoom.us': 'Zoom',
  'teams': 'Microsoft Teams',
  'microsoft teams': 'Microsoft Teams',
  'orbstack helper': 'OrbStack',
  'webstorm': 'WebStorm',
  'idea': 'IntelliJ',
  'code': 'VS Code',
  'code helper': 'VS Code',
  'adobe photoshop': 'Photoshop',
  'adobe acrobat': 'Adobe Acrobat',
};

function friendlyName(rawName) {
  return FRIENDLY_NAMES[rawName.toLowerCase()] || rawName;
}

/**
 * Returns top non-essential processes sorted by memory usage.
 * Each entry: { name, friendlyName, pid, memMB, memPct }
 */
function getHeavyProcesses(limit = 5) {
  const platform = process.platform;
  const totalMB = Math.round(os.totalmem() / (1024 * 1024));
  try {
    let procs;
    if (platform === 'darwin') {
      const raw = execSync('ps -axo pid,rss,comm | sort -k2 -rn | head -30', { encoding: 'utf8', timeout: 5000 });
      procs = raw.trim().split('\n').map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const rssKB = parseInt(parts[1], 10);
        const comm = parts.slice(2).join(' ');
        const name = comm.split('/').pop();
        return { name, pid, memMB: Math.round(rssKB / 1024) };
      }).filter(p => p.pid && p.memMB);
    } else {
      const raw = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 5000 });
      procs = raw.trim().split('\n').map(line => {
        const cols = line.match(/"([^"]*)"/g);
        if (!cols || cols.length < 5) return null;
        const name = cols[0].replace(/"/g, '');
        const pid = parseInt(cols[1].replace(/"/g, ''), 10);
        const memStr = cols[4].replace(/"/g, '').replace(/[^0-9]/g, '');
        return { name: name.replace('.exe', ''), pid, memMB: Math.round(parseInt(memStr, 10) / 1024) };
      }).filter(Boolean).sort((a, b) => b.memMB - a.memMB);
    }

    const filtered = procs
      .filter(p => !isProtected(p.name))
      .map(p => ({ ...p, friendlyName: friendlyName(p.name), memPct: Math.round((p.memMB / totalMB) * 100) }));

    // Consolidate duplicates (e.g. multiple Chrome Helper processes)
    const grouped = new Map();
    for (const p of filtered) {
      const key = p.friendlyName;
      if (grouped.has(key)) {
        const g = grouped.get(key);
        g.memMB += p.memMB;
        g.memPct += p.memPct;
        g.pids.push(p.pid);
      } else {
        grouped.set(key, { ...p, pids: [p.pid] });
      }
    }

    return [...grouped.values()]
      .sort((a, b) => b.memMB - a.memMB)
      .slice(0, limit);
  } catch (err) {
    console.error('[system-monitor] getHeavyProcesses error:', err.message);
    return [];
  }
}

/**
 * Kills the given processes by PID. Returns count of successfully killed.
 */
function killProcesses(pids) {
  const platform = process.platform;
  let killed = 0;
  for (const pid of pids) {
    try {
      if (platform === 'darwin') {
        execSync(`kill ${pid}`, { stdio: 'ignore', timeout: 3000 });
      } else {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 3000 });
      }
      killed++;
    } catch (_) { /* process may have already exited */ }
  }
  return killed;
}

function checkSystem() {
  // Return at most one suggestion — memory takes priority, then CPU, then reboot
  const mem = checkMemory();
  if (mem) return [mem];
  const cpu = checkCpu();
  if (cpu) return [cpu];
  const up = checkUptime();
  if (up) return [up];
  return [];
}

module.exports = { checkUptime, checkMemory, checkCpu, checkSystem, getHeavyProcesses, killProcesses };

// Self-test: node system-monitor.js
if (require.main === module) {
  console.log('Uptime:', checkUptime() || '(ok)');
  console.log('Memory:', checkMemory() || '(ok)');
  console.log('CPU:', checkCpu() || '(ok)');
  console.log('All:', checkSystem());
}
