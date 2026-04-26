import React, { useState, useRef, useEffect } from 'react';

function App() {
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://YOUR_BACKEND_URL';

  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('diagnosis');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [currentCamera, setCurrentCamera] = useState('environment');
  const [chatHistory, setChatHistory] = useState([]);
  const [userMessage, setUserMessage] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const chatRef = useRef(null);

  // Initial chat message
  useEffect(() => {
    setChatHistory([{
      role: 'bot',
      text: 'Hello! I am your AI skin health assistant. Ask me about skin conditions!'
    }]);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target.result);
        setImageFile(file);
        setResult(null);
        setError('');
        // Stop camera if image is uploaded manually
        stopCamera(); 
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = (facingMode) => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      setIsCameraActive(true);
      setError('');
      
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: facingMode || 'environment',
          width: { ideal: 640 }, // Optimize for common mobile resolution
          height: { ideal: 480 }
        }, 
        audio: false 
      })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            setCurrentCamera(facingMode || 'environment');
          }
        })
        .catch(err => {
          console.error("Camera access error:", err);
          setError('Camera access denied. Please allow camera permissions.');
          setIsCameraActive(false);
        });
    } else {
      setError('Camera not supported in this browser.');
    }
  };

  const switchCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    const newCamera = currentCamera === 'environment' ? 'user' : 'environment';
    startCamera(newCamera);
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      setIsCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      // Set canvas dimensions based on video feed
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      
      const capturedImage = canvasRef.current.toDataURL('image/jpeg');
      setImage(capturedImage);
      fetch(capturedImage)
        .then((res) => res.blob())
        .then((blob) => setImageFile(new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' })))
        .catch(() => setImageFile(null));
      setResult(null);
      setError('');
      stopCamera();
    }
  };

  // --- Image Analysis Function (Backend API Call) ---
  const analyzeImage = async () => {
    if (!image) {
      setError('Please select an image first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      if (imageFile) {
        formData.append('image', imageFile);
      } else {
        formData.append('image', image);
      }

      const response = await fetch(`${BACKEND_URL}/analyze`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || `Server returned ${response.status}`);
      }

      if (!data.valid) {
        setResult(null);
        setError(data.message || 'Invalid input: Please upload a skin-related image');
        return;
      }

      setResult({
        ...data,
        timestamp: new Date().toLocaleString()
      });
    } catch (err) {
      console.error('Analysis Error:', err);
      setResult(null);
      setError(err.message || 'Could not connect to analysis server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // --- Chatbot Function (Local Demo Response) ---
  const sendMessage = async () => {
    if (userMessage.trim() === '') return;

    const newMessage = { role: 'user', text: userMessage };
    setChatHistory(prev => [...prev, newMessage]);
    setUserMessage('');
    setIsChatting(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const botMessage = 'Thanks for your question. For safety, this demo chat is currently running without direct AI access. Please consult a dermatologist for medical advice.';
      setChatHistory(prev => [...prev, { role: 'bot', text: botMessage }]);
    } catch (err) {
      console.error('Chat Error:', err);
      setChatHistory(prev => [...prev, { role: 'bot', text: 'I am experiencing technical difficulties. Please try again later.' }]);
    } finally {
      setIsChatting(false);
    }
  };

  // Helper for responsive layout
  const isMobile = window.innerWidth <= 768;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px',
      fontFamily: 'Inter, Arial, sans-serif'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '30px', color: 'white' }}>
          <div style={{ fontSize: '4rem', marginBottom: '10px' }}>🩺</div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '800', margin: '0 0 15px 0' }}>
            Arogya Mitra
          </h1>
          <p style={{ fontSize: '1.1rem', opacity: '0.9' }}>
            AI-Powered Skin Health Analysis & Assistant
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '25px' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '15px', padding: '5px' }}>
            <button
              onClick={() => { setActiveTab('diagnosis'); stopCamera(); }}
              style={{
                padding: '12px 25px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: activeTab === 'diagnosis' ? 'white' : 'transparent',
                color: activeTab === 'diagnosis' ? '#333' : 'white',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.3s'
              }}
            >
              🔬 Skin Analysis
            </button>
            <button
              onClick={() => setActiveTab('chatbot')}
              style={{
                padding: '12px 25px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: activeTab === 'chatbot' ? 'white' : 'transparent',
                color: activeTab === 'chatbot' ? '#333' : 'white',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.3s'
              }}
            >
              🤖 AI Assistant
            </button>
          </div>
        </div>

        {/* Diagnosis Tab Content */}
        {activeTab === 'diagnosis' && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '25px' }}>
            
            {/* Image Upload/Capture Panel */}
            <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '25px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '20px' }}>
                📸 Upload or Capture Image
              </h2>

              <div style={{
                border: isCameraActive ? '3px solid #667eea' : '3px dashed #ccc',
                borderRadius: '15px',
                padding: isCameraActive ? '0' : '25px',
                textAlign: 'center',
                marginBottom: '20px',
                minHeight: '220px',
                maxHeight: '400px', // Added max height for better control
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}>
                {isCameraActive ? (
                  <div style={{ width: '100%' }}>
                    <video 
                      ref={videoRef} 
                      style={{ width: '100%', height: 'auto', borderRadius: '10px', objectFit: 'cover' }} 
                      autoPlay 
                      playsInline
                      muted
                    ></video>
                    <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
                  </div>
                ) : image ? (
                  <div style={{padding: '15px'}}>
                    <img src={image} alt="Preview" style={{ maxWidth: '100%', maxHeight: '370px', borderRadius: '10px', objectFit: 'contain' }} />
                    <p style={{ marginTop: '15px', color: '#10b981', fontWeight: '600' }}>
                      ✅ Image ready for analysis
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '4rem', marginBottom: '15px', color: '#9ca3af' }}>📷</div>
                    <p style={{ fontSize: '1.1rem', color: '#666', fontWeight: '500' }}>
                      Upload image or use camera
                    </p>
                  </div>
                )}
              </div>

              <input type="file" accept="image/*" onChange={handleFileSelect} ref={fileRef} style={{ display: 'none' }} />

              {isCameraActive ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                  <button
                    onClick={capturePhoto}
                    style={{
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      padding: '12px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      boxShadow: '0 4px #b91c1c'
                    }}
                  >
                    📸 Capture
                  </button>
                  <button
                    onClick={switchCamera}
                    style={{
                      background: '#8b5cf6',
                      color: 'white',
                      border: 'none',
                      padding: '12px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      boxShadow: '0 4px #7c3aed'
                    }}
                  >
                    🔄 Flip
                  </button>
                  <button
                    onClick={stopCamera}
                    style={{
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      padding: '12px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      boxShadow: '0 4px #4b5563'
                    }}
                  >
                    ❌ Close
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                  <button
                    onClick={() => fileRef.current.click()}
                    style={{
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      padding: '14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      boxShadow: '0 4px #059669'
                    }}
                  >
                    📁 Upload
                  </button>
                  <button
                    onClick={() => startCamera('environment')}
                    style={{
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      padding: '14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      boxShadow: '0 4px #2563eb'
                    }}
                  >
                    📷 Camera
                  </button>
                  <button
                    onClick={analyzeImage}
                    disabled={!image || loading}
                    style={{
                      background: loading || !image ? '#ccc' : '#667eea',
                      color: 'white',
                      border: 'none',
                      padding: '14px',
                      borderRadius: '10px',
                      cursor: loading || !image ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      boxShadow: loading || !image ? 'none' : '0 4px #5a66c4',
                      opacity: loading || !image ? 0.7 : 1,
                      transition: 'all 0.3s'
                    }}
                  >
                    {loading ? '🔍 Analyzing...' : '🧠 Analyze'}
                  </button>
                </div>
              )}

              <div style={{ padding: '15px', backgroundColor: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a' }}>
                <h4 style={{ color: '#92400e', marginBottom: '10px', borderBottom: '1px solid #fde68a', paddingBottom: '5px' }}>💡 Tips for Best Results:</h4>
                <ul style={{ fontSize: '0.9rem', color: '#78350f', paddingLeft: '20px', listStyleType: 'disc' }}>
                  <li>Use good, focused lighting (natural light is best).</li>
                  <li>Keep image clear and sharply focused.</li>
                  <li>Show the affected area clearly and close-up.</li>
                </ul>
              </div>
            </div>

            {/* Analysis Results Panel */}
            <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '25px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '20px' }}>
                📊 Analysis Results
              </h2>
              
              {loading && (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '15px' }}>🔍</div>
                  <h3 style={{ color: '#667eea' }}>AI is analyzing...</h3>
                  <p style={{ color: '#9ca3af' }}>This may take a few moments.</p>
                </div>
              )}

              {error && (
                <div style={{ backgroundColor: '#fef2f2', padding: '20px', borderRadius: '10px', border: '2px solid #f87171', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '15px', color: '#dc2626' }}>❌</div>
                  <h3 style={{ color: '#dc2626' }}>Error</h3>
                  <p style={{ color: '#7f1d1d', wordBreak: 'break-word' }}>Analysis failed: {error}</p>
                </div>
              )}

              {!loading && !error && !result && (
                 <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '15px' }}>📝</div>
                    <h3>Waiting for Analysis</h3>
                    <p>Upload an image and press 'Analyze' to begin.</p>
                 </div>
              )}

              {result && (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '10px', color: '#059669' }}>✅</div>
                    <h2 style={{ color: '#059669' }}>Analysis Complete</h2>
                  </div>
                  <div style={{ backgroundColor: '#f0fdf4', padding: '20px', borderRadius: '10px', marginBottom: '15px', border: '1px solid #d1fae5' }}>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '1rem',
                      lineHeight: '1.6',
                      margin: 0,
                      color: '#10b981'
                    }}>
                      Disease: {result.disease}
Confidence: {(result.confidence * 100).toFixed(0)}%
Severity: {result.severity}
Recommendation: {result.recommendation}
                    </pre>
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#666', textAlign: 'right', marginBottom: '15px' }}>
                    🕒 Analysis Time: {result.timestamp}
                  </div>
                  <div style={{ backgroundColor: '#fef3c7', padding: '15px', borderRadius: '10px', border: '1px solid #fcd34d' }}>
                    <h4 style={{ color: '#92400e' }}>⚠️ Medical Disclaimer</h4>
                    <p style={{ color: '#78350f', fontSize: '0.9rem' }}>
                      This analysis is for educational and informational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chatbot Tab Content */}
        {activeTab === 'chatbot' && (
          <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: isMobile ? '15px' : '25px', maxWidth: '800px', margin: '0 auto', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '10px', color: '#667eea' }}>🤖</div>
              <h2>AI Skin Health Assistant</h2>
              <p style={{ color: '#666' }}>Ask me anything about skin conditions and treatments.</p>
            </div>

            <div 
              ref={chatRef}
              style={{
                height: '350px',
                overflowY: 'auto',
                border: '2px solid #e5e7eb',
                borderRadius: '15px',
                padding: '20px',
                marginBottom: '20px',
                backgroundColor: '#f9fafb'
              }}
            >
              {chatHistory.map((msg, index) => (
                <div 
                  key={index} 
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '15px'
                  }}
                >
                  <div style={{
                    maxWidth: '80%',
                    padding: '12px 16px',
                    borderRadius: '18px',
                    borderTopLeftRadius: msg.role === 'user' ? '18px' : '0',
                    borderTopRightRadius: msg.role === 'user' ? '0' : '18px',
                    backgroundColor: msg.role === 'user' ? '#667eea' : '#e5e7eb',
                    color: msg.role === 'user' ? 'white' : '#333',
                    wordWrap: 'break-word',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              
              {isChatting && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '18px',
                    borderTopRightRadius: '18px',
                    backgroundColor: '#e5e7eb',
                    color: '#333'
                  }}>
                    <span role="img" aria-label="typing">...</span> Typing
                  </div>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Ask about skin conditions..."
                disabled={isChatting}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  border: '2px solid #e5e7eb',
                  borderRadius: '25px',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'border-color 0.3s'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={isChatting || userMessage.trim() === ''}
                style={{
                  background: isChatting || userMessage.trim() === '' ? '#ccc' : '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '48px',
                  height: '48px',
                  cursor: isChatting || userMessage.trim() === '' ? 'not-allowed' : 'pointer',
                  fontSize: '1.2rem',
                  boxShadow: isChatting || userMessage.trim() === '' ? 'none' : '0 4px #5a66c4',
                  transition: 'background-color 0.3s, box-shadow 0.3s'
                }}
              >
                {isChatting ? '💬' : '🚀'}
              </button>
            </div>

            {/* Suggested Prompts */}
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f9ff', borderRadius: '10px', border: '1px solid #bae6fd' }}>
              <h4 style={{ color: '#0369a1', marginBottom: '10px' }}>💬 Quick Questions:</h4>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
                <button
                  onClick={() => setUserMessage('What are the symptoms of eczema?')}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'white',
                    border: '1px solid #bae6fd',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: '#0369a1',
                    textAlign: 'left',
                    fontSize: '0.9rem',
                    transition: 'background-color 0.1s'
                  }}
                >
                  What are the symptoms of eczema?
                </button>
                <button
                  onClick={() => setUserMessage('What are home remedies for mild sunburn?')}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'white',
                    border: '1px solid #bae6fd',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: '#0369a1',
                    textAlign: 'left',
                    fontSize: '0.9rem',
                    transition: 'background-color 0.1s'
                  }}
                >
                  Home remedies for mild sunburn?
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '40px', color: 'rgba(255,255,255,0.8)' }}>
          <p style={{fontSize: '0.9rem'}}>Powered by Google Gemini AI</p>
        </div>
      </div>
    </div>
  );
}

export default App;
