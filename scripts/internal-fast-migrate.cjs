const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../data/skills/index.jsonl');

if (!fs.existsSync(file)) process.exit(0);

const content = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

const translations = [
  { lobe: "Prefrontal Cortex", region: "Motor Commands", cluster: "Git Unrelated Histories", summary: "git pull main allow unrelated histories" },
  { lobe: "Temporal Lobe", region: "Error Resolution", cluster: "Git Merge Conflicts", summary: "Fixing fatal refusing to merge unrelated histories" },
  { lobe: "Parietal Lobe", region: "Syntactical Memory", cluster: "Bash Execution", summary: "Bash CLI syntax for handling unrelated histories merge" },
  // session 2
  { lobe: "Prefrontal Cortex", region: "Motor Commands", cluster: "Git Unrelated Histories", summary: "git pull main allow unrelated histories (Dupe A)" },
  { lobe: "Temporal Lobe", region: "Error Resolution", cluster: "Git Merge Conflicts", summary: "Fixing fatal refusing to merge unrelated histories (Dupe A)" },
  { lobe: "Parietal Lobe", region: "Syntactical Memory", cluster: "Bash Execution", summary: "Bash CLI syntax for handling unrelated histories merge (Dupe A)" },
  // session 3
  { lobe: "Prefrontal Cortex", region: "Motor Commands", cluster: "Git Unrelated Histories", summary: "git pull main allow unrelated histories (Dupe B)" },
  { lobe: "Temporal Lobe", region: "Error Resolution", cluster: "Git Merge Conflicts", summary: "Fixing fatal refusing to merge unrelated histories (Dupe B)" },
  { lobe: "Parietal Lobe", region: "Syntactical Memory", cluster: "Bash Execution", summary: "Bash CLI syntax for handling unrelated histories merge (Dupe B)" }
];

const newContent = content.map((line, idx) => {
  const obj = JSON.parse(line);
  if(translations[idx]) {
    obj.lobe = translations[idx].lobe;
    obj.region = translations[idx].region;
    obj.cluster = translations[idx].cluster;
    
    // Purge the old Memory Palace keys to keep the DB clean
    delete obj.wing;
    delete obj.hall;
    delete obj.room;

    obj.summary = translations[idx].summary;
  }
  return JSON.stringify(obj);
});

fs.writeFileSync(file, newContent.join('\n') + '\n');
console.log("Memory Palace logic eradicated. Synaptic clusters re-established.");
