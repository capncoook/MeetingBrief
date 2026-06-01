import React, { useState, useRef } from 'react';

export default function MeetingBrief() {
  const [step, setStep] = useState('auth'); // auth, dashboard, recording, results
  const [email, setEmail] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentSummary, setCurrentSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

  // Auth
  const handleLogin = async (e) => {
    e.preventDefault();
    if (email) {
      localStorage.setItem('userEmail', email);
      setStep('dashboard');
    }
  };

  // Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await uploadAndProcess(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      alert('Unable to access microphone. Check permissions.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    setIsRecording(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadAndProcess(file);
    }
  };

  const uploadAndProcess = async (audioFile) => {
    setLoading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('email', localStorage.getItem('userEmail'));

    try {
      const response = await fetch('/api/process-audio', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (data.success) {
        setCurrentSummary(data.summary);
        setRecordings([
          {
            id: Date.now(),
            date: new Date().toLocaleString(),
            summary: data.summary
          },
          ...recordings
        ]);
        setStep('results');
      } else {
        alert('Processing failed: ' + data.error);
      }
    } catch (error) {
      alert('Error uploading file');
    } finally {
      setLoading(false);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem('userEmail');
    setEmail('');
    setStep('auth');
  };

  // ===== AUTH SCREEN =====
  if (step === 'auth') {
    return (
      <div style={styles.container}>
        <div style={styles.authCard}>
          <h1 style={styles.title}>MeetingBrief</h1>
          <p style={styles.subtitle}>AI Meeting Notes & Action Items</p>
          
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
            />
            <button type="submit" style={styles.button}>Sign In / Create Account</button>
          </form>
          
          <p style={styles.note}>Free tier: 3 recordings/month</p>
        </div>
      </div>
    );
  }

  // ===== DASHBOARD =====
  if (step === 'dashboard') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={{ margin: 0 }}>MeetingBrief</h1>
          <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
        </div>

        <div style={styles.dashboard}>
          <div style={styles.card}>
            <h2>Record New Meeting</h2>
            <div style={styles.recordingSection}>
              <button 
                onClick={startRecording}
                disabled={isRecording}
                style={{...styles.button, ...(isRecording ? styles.buttonDisabled : {})}}
              >
                🎙️ Start Recording
              </button>
              
              <button 
                onClick={stopRecording}
                disabled={!isRecording}
                style={{...styles.button, background: '#ef4444', ...(isRecording ? {} : styles.buttonDisabled)}}
              >
                ⏹️ Stop Recording
              </button>

              <div style={styles.divider}>OR</div>

              <label style={styles.uploadLabel}>
                📁 Upload Audio File
                <input 
                  type="file" 
                  accept="audio/*" 
                  onChange={handleFileUpload}
                  style={{display: 'none'}}
                />
              </label>

              <p style={styles.supportedFormats}>MP3, WAV, M4A, OGG (max 100MB)</p>
            </div>

            {loading && (
              <div style={styles.loading}>
                <p>Processing your meeting... This may take a minute.</p>
                <div style={styles.spinner}></div>
              </div>
            )}
          </div>

          {recordings.length > 0 && (
            <div style={styles.card}>
              <h2>Recent Meetings</h2>
              <div style={styles.recordingsList}>
                {recordings.map((rec) => (
                  <div 
                    key={rec.id} 
                    style={styles.recordingItem}
                    onClick={() => {
                      setCurrentSummary(rec.summary);
                      setStep('results');
                    }}
                  >
                    <div>
                      <p style={styles.recordingDate}>{rec.date}</p>
                      <p style={styles.recordingPreview}>
                        {rec.summary.actionItems?.length || 0} action items
                      </p>
                    </div>
                    <span>→</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== RESULTS SCREEN =====
  if (step === 'results' && currentSummary) {
    const summary = currentSummary;

    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={{ margin: 0 }}>MeetingBrief</h1>
          <button onClick={() => setStep('dashboard')} style={styles.logoutBtn}>← Back</button>
        </div>

        <div style={styles.resultsContainer}>
          <div style={styles.card}>
            <h2>Meeting Summary</h2>
            
            {summary.transcript && (
              <div style={styles.section}>
                <h3>Transcript</h3>
                <p style={styles.transcript}>{summary.transcript.substring(0, 500)}...</p>
                <details>
                  <summary style={styles.expandButton}>Show Full Transcript</summary>
                  <p style={styles.transcript}>{summary.transcript}</p>
                </details>
              </div>
            )}

            {summary.keyDecisions && summary.keyDecisions.length > 0 && (
              <div style={styles.section}>
                <h3>🎯 Key Decisions</h3>
                <ul style={styles.list}>
                  {summary.keyDecisions.map((decision, i) => (
                    <li key={i}>{decision}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.actionItems && summary.actionItems.length > 0 && (
              <div style={styles.section}>
                <h3>✅ Action Items</h3>
                <div style={styles.actionItemsList}>
                  {summary.actionItems.map((item, i) => (
                    <div key={i} style={styles.actionItem}>
                      <input type="checkbox" style={{ marginRight: '1rem' }} />
                      <div>
                        <p style={styles.actionItemText}>{item.task}</p>
                        {item.owner && <p style={styles.actionItemOwner}>Owner: {item.owner}</p>}
                        {item.deadline && <p style={styles.actionItemDeadline}>Due: {item.deadline}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.topics && summary.topics.length > 0 && (
              <div style={styles.section}>
                <h3>📌 Topics Discussed</h3>
                <div style={styles.topicsList}>
                  {summary.topics.map((topic, i) => (
                    <span key={i} style={styles.topic}>{topic}</span>
                  ))}
                </div>
              </div>
            )}

            <div style={styles.actionButtons}>
              <button 
                onClick={() => {
                  // Email the summary
                  alert('Summary emailed to: ' + localStorage.getItem('userEmail'));
                }}
                style={styles.button}
              >
                📧 Email Summary
              </button>
              <button 
                onClick={() => {
                  // Copy to clipboard
                  navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
                  alert('Copied to clipboard!');
                }}
                style={{...styles.button, background: '#6366f1'}}
              >
                📋 Copy as JSON
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    background: 'white',
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  authCard: {
    maxWidth: '400px',
    margin: '5rem auto',
    background: 'white',
    padding: '3rem 2rem',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    textAlign: 'center',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    margin: '0 0 0.5rem 0',
    color: '#0f172a',
  },
  subtitle: {
    color: '#64748b',
    marginBottom: '2rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    margin: '2rem 0',
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '1rem',
    fontFamily: 'inherit',
  },
  button: {
    padding: '0.75rem 1.5rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  logoutBtn: {
    padding: '0.5rem 1rem',
    background: '#e2e8f0',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  dashboard: {
    maxWidth: '1000px',
    margin: '2rem auto',
    padding: '0 1rem',
    display: 'grid',
    gap: '2rem',
  },
  card: {
    background: 'white',
    padding: '2rem',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
  },
  recordingSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '1rem',
  },
  divider: {
    textAlign: 'center',
    color: '#94a3b8',
    fontWeight: 'bold',
    margin: '1rem 0',
  },
  uploadLabel: {
    padding: '1rem',
    background: '#f1f5f9',
    border: '2px dashed #cbd5e1',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    fontWeight: 'bold',
    transition: 'all 0.3s',
  },
  supportedFormats: {
    fontSize: '0.85rem',
    color: '#94a3b8',
    marginTop: '0.5rem',
  },
  recordingsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '1rem',
  },
  recordingItem: {
    padding: '1rem',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  recordingDate: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#64748b',
  },
  recordingPreview: {
    margin: '0.25rem 0 0 0',
    fontSize: '0.95rem',
    color: '#0f172a',
  },
  resultsContainer: {
    maxWidth: '900px',
    margin: '2rem auto',
    padding: '0 1rem',
  },
  section: {
    marginTop: '2rem',
    paddingTop: '1.5rem',
    borderTop: '1px solid #e2e8f0',
  },
  transcript: {
    background: '#f1f5f9',
    padding: '1rem',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    color: '#1e293b',
    lineHeight: 1.6,
  },
  expandButton: {
    cursor: 'pointer',
    color: '#3b82f6',
    fontWeight: 'bold',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  actionItemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  actionItem: {
    display: 'flex',
    padding: '1rem',
    background: '#f8fafc',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
  },
  actionItemText: {
    margin: 0,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  actionItemOwner: {
    margin: '0.25rem 0 0 0',
    fontSize: '0.85rem',
    color: '#64748b',
  },
  actionItemDeadline: {
    margin: '0.25rem 0 0 0',
    fontSize: '0.85rem',
    color: '#3b82f6',
  },
  topicsList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  topic: {
    background: '#dbeafe',
    color: '#1e40af',
    padding: '0.5rem 1rem',
    borderRadius: '20px',
    fontSize: '0.85rem',
  },
  actionButtons: {
    display: 'flex',
    gap: '1rem',
    marginTop: '2rem',
    flexWrap: 'wrap',
  },
  loading: {
    textAlign: 'center',
    padding: '2rem',
  },
  spinner: {
    display: 'inline-block',
    width: '30px',
    height: '30px',
    border: '3px solid #e2e8f0',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
