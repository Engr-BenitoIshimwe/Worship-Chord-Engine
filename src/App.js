import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// ============ UTILITY FUNCTIONS ============
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const ENHARMONIC = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  'E#': 'F',
  Fb: 'E',
  'B#': 'C',
};

function normalizeRoot(root) {
  return ENHARMONIC[root] || root;
}

function semitoneDistance(from, to) {
  const a = NOTES.indexOf(normalizeRoot(from));
  const b = NOTES.indexOf(normalizeRoot(to));
  if (a === -1 || b === -1) return 0;
  return (b - a + NOTES.length) % NOTES.length;
}

function splitChord(chord) {
  if (!chord) return { root: '', suffix: '' };

  const match = chord.match(/^([A-G][b#]?)(.*)$/);
  if (!match) return { root: chord.trim(), suffix: '' };

  return {
    root: match[1],
    suffix: match[2].replace(/\//g, '/'),
  };
}

function transposeChord(chord, semitones) {
  const { root, suffix } = splitChord(chord);
  if (!root || NOTES.indexOf(normalizeRoot(root)) === -1) return chord;

  const currentIdx = NOTES.indexOf(normalizeRoot(root));
  const newIdx = (currentIdx + semitones + NOTES.length) % NOTES.length;
  const newRoot = NOTES[newIdx];

  return newRoot + suffix;
}

function toShapeChord(chord, songKey, shapeKey) {
  const capo = semitoneDistance(shapeKey, songKey);
  return transposeChord(chord, -capo);
}

// ============ SONG PARSER ============
function parseSong(rawText) {
  const lines = rawText.split('\n');
  const sections = [];
  let currentSection = null;

  // Auto-detect key
  const keyMatch = rawText.match(/(?:^|\n)Key[:\s]+([A-G][b#]?)\b/i);
  let detectedKey = keyMatch ? keyMatch[1] : 'C';

  if (!keyMatch) {
    const firstChordLine = lines.find((line) => line.match(/[A-G][b#]?\s/));
    if (firstChordLine) {
      const firstChord = firstChordLine.trim().split(/\s+/)[0];
      const chordRoot = splitChord(firstChord).root;
      if (chordRoot) detectedKey = chordRoot;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Enhanced section label detection
    const uppercaseLine = line.toUpperCase();
    const isSectionLabel =
      uppercaseLine.match(
        /^(VERSE|CHORUS|BRIDGE|INTRO|OUTRO|PRE-CHORUS|INTERLUDE|INSTRUMENTAL|TAG|ENDING)\s*\d*$/i
      ) ||
      (line.startsWith('[') &&
        uppercaseLine.match(
          /^(VERSE|CHORUS|BRIDGE|INTRO|OUTRO|PRE-CHORUS|INTERLUDE|INSTRUMENTAL|TAG|ENDING)/i
        )) ||
      (line.startsWith('[') && line.endsWith(']')) ||
      (line.match(/^[A-Z\s]+\d*$/) && line.length < 30 && !line.match(/[a-z]/));

    if (isSectionLabel) {
      if (currentSection) sections.push({ ...currentSection });

      // Clean and format section label
      let cleanLabel = line.replace(/[\[\]]/g, '').trim();
      if (cleanLabel.match(/^\d/)) {
        cleanLabel = `Verse ${cleanLabel}`;
      }

      currentSection = {
        label: cleanLabel.toUpperCase(),
        lines: [],
      };
      continue;
    }

    // Check if line has chords
    const hasChords =
      line.match(/[A-G][b#]?\s/) &&
      (i + 1 >= lines.length || !lines[i + 1].trim().match(/[A-G][b#]?\s/));

    if (hasChords && i + 1 < lines.length) {
      const chordLine = line;
      const lyricLine = lines[i + 1].trim();

      if (!currentSection) {
        currentSection = { label: '', lines: [] };
      }

      currentSection.lines.push({
        chordLine,
        lyricLine,
        chords: extractChordsWithPositions(chordLine),
      });

      i++; // Skip next line
    } else if (currentSection) {
      currentSection.lines.push({
        chordLine: '',
        lyricLine: line,
        chords: [],
      });
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return { sections, key: detectedKey };
}

function extractChordsWithPositions(line) {
  const chords = [];
  const regex =
    /([A-G][b#]?(?:maj|min|m|sus|add|dim|aug)?\d*(?:\/[A-G][b#]?)?)/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    chords.push({
      chord: match[1],
      position: match.index,
      length: match[1].length,
    });
  }

  // Sort by position
  chords.sort((a, b) => a.position - b.position);

  return chords;
}

// FIXED FUNCTION: Now returns segments instead of using String.repeat with negative values
function formatChordLine(chords, lyricLine, transformFn = null) {
  const segments = [];
  let currentPos = 0;

  // Transform chords
  const transformedChords = chords.map(({ chord, position, length }) => ({
    chord: transformFn ? transformFn(chord) : chord,
    position,
    length: transformFn ? transformFn(chord).length : length,
  }));

  // Sort chords by position
  transformedChords.sort((a, b) => a.position - b.position);

  // Build segments
  for (const chord of transformedChords) {
    // Add spaces before chord if needed
    if (chord.position > currentPos) {
      const spaceLength = Math.max(0, chord.position - currentPos);
      segments.push({
        type: 'space',
        text: ' '.repeat(spaceLength),
        length: spaceLength,
      });
      currentPos = chord.position;
    }

    // Add chord
    segments.push({
      type: 'chord',
      text: chord.chord,
      length: chord.chord.length,
    });
    currentPos += chord.chord.length;
  }

  // Add trailing spaces if needed to match lyric line length
  if (currentPos < lyricLine.length) {
    const spaceLength = Math.max(0, lyricLine.length - currentPos);
    segments.push({
      type: 'space',
      text: ' '.repeat(spaceLength),
      length: spaceLength,
    });
  }

  return {
    segments,
    lyricLine,
  };
}

// ============ REACT COMPONENTS ============
function ChordSheet({ title, capo, sections, key: songKey, shapeKey }) {
  const transformChord = (chord) => toShapeChord(chord, songKey, shapeKey);

  return (
    <div className="chord-sheet">
      <div className="sheet-header">
        <h3>{title}</h3>
        <div className="capo-info">Capo: {capo}</div>
      </div>

      <div className="song-content">
        {sections.map((section, sectionIndex) => (
          <div key={sectionIndex} className="song-section">
            {section.label && (
              <div className="section-label">
                <strong>{section.label}</strong>
              </div>
            )}

            {section.lines.map((line, lineIndex) => {
              if (!line.chordLine) {
                return (
                  <div key={lineIndex} className="lyric-line-only">
                    {line.lyricLine}
                  </div>
                );
              }

              const formatted = formatChordLine(
                line.chords,
                line.lyricLine,
                transformChord
              );

              return (
                <div key={lineIndex} className="line-pair">
                  <div className="chord-line">
                    {formatted.segments.map((segment, idx) =>
                      segment.type === 'chord' ? (
                        <strong key={idx} className="chord-text">
                          {segment.text}
                        </strong>
                      ) : (
                        <span key={idx}>{segment.text}</span>
                      )
                    )}
                  </div>
                  <div className="lyric-line">{formatted.lyricLine}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SongResult({ songText, songKey: initialKey }) {
  const parsed = parseSong(songText);
  const [songKey, setSongKey] = useState(initialKey || parsed.key);

  const capoC = semitoneDistance('C', songKey);
  const capoG = semitoneDistance('G', songKey);

  return (
    <div className="song-result">
      <div className="key-selector">
        <label>Song Key: </label>
        <select value={songKey} onChange={(e) => setSongKey(e.target.value)}>
          {NOTES.map((note) => (
            <option key={note} value={note}>
              {note}
            </option>
          ))}
        </select>
      </div>

      <div className="sheets-container">
        <ChordSheet
          title="C-Shape Version"
          capo={capoC}
          sections={parsed.sections}
          key={songKey}
          shapeKey="C"
        />

        <ChordSheet
          title="G-Shape Version"
          capo={capoG}
          sections={parsed.sections}
          key={songKey}
          shapeKey="G"
        />
      </div>
    </div>
  );
}

function App() {
  const [rawInput, setRawInput] = useState(`Here I Am to Worship
Key: D

VERSE 1
D            A
Light of the world
             Em
You stepped down into darkness
G               D
Opened my eyes, let me see

CHORUS
G          D
Here I am to worship
Em         A
Here I am to bow down
G          D
Here I am to say that You're my God

[BRIDGE]
G     D     Em    A
You're altogether lovely
G     D     C
Altogether worthy
Em    A     D
Altogether wonderful to me

VERSE 2
D               A
King of all days
                Em
Oh so highly exalted
G              D
Glorious in heaven above

[CHORUS]
G          D
Here I am to worship
Em         A
Here I am to bow down
G          D
Here I am to say that You're my God`);

  const [songs, setSongs] = useState([]);
  const [processedSongs, setProcessedSongs] = useState([]);

  const processSongs = useCallback(() => {
    const songBlocks = rawInput.split(/\n-{3,}\n/);
    const parsedSongs = songBlocks
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((block) => ({ text: block }));

    setSongs(parsedSongs);
    setProcessedSongs(parsedSongs.map((song) => parseSong(song.text)));
  }, [rawInput]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Chord sheet copied to clipboard!');
    });
  };

  useEffect(() => {
    processSongs();
  }, [processSongs]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Worship Chord Engine</h1>
        <p className="subtitle">
          Convert songs to C-shape and G-shape with auto capo calculation
        </p>
      </header>

      <div className="main-container">
        <div className="input-section">
          <div className="input-header">
            <h2>Input Songs</h2>
            <div className="format-guide">
              <strong>Format:</strong> Use section labels like VERSE, CHORUS,
              BRIDGE (in all caps or brackets)
            </div>
          </div>

          <textarea
            className="song-input"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={`Paste your songs here, separated by "---" between songs.

Example format:
Key: D

VERSE 1
D            A
Light of the world

CHORUS
G          D
Here I am to worship

---`}
            rows={20}
          />

          <button className="process-btn" onClick={processSongs}>
            Process Songs
          </button>
        </div>

        <div className="output-section">
          <h2>Processed Songs</h2>

          {songs.length === 0 ? (
            <div className="empty-state">
              <p>
                No songs processed yet. Paste your songs and click "Process
                Songs".
              </p>
            </div>
          ) : (
            <div className="songs-list">
              {songs.map((song, index) => (
                <div key={index} className="song-card">
                  <SongResult
                    songText={song.text}
                    songKey={processedSongs[index]?.key}
                  />

                  <div className="copy-buttons">
                    <button
                      className="copy-btn"
                      onClick={() => {
                        const text = document.querySelector(
                          `.song-card:nth-child(${
                            index + 1
                          }) .chord-sheet:first-child`
                        ).innerText;
                        copyToClipboard(text);
                      }}
                    >
                      Copy C-Shape Sheet
                    </button>
                    <button
                      className="copy-btn"
                      onClick={() => {
                        const text = document.querySelector(
                          `.song-card:nth-child(${
                            index + 1
                          }) .chord-sheet:last-child`
                        ).innerText;
                        copyToClipboard(text);
                      }}
                    >
                      Copy G-Shape Sheet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="app-footer">
        <p>
          Worship Chord Engine • All chords and section titles in bold black for
          clarity
        </p>
      </footer>
    </div>
  );
}

export default App;
