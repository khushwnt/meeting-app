import React from 'react';
import VideoConsultation from './VideoConsultation';

/**
 * Main App Component
 * 
 * This is a wrapper that renders the VideoConsultation component.
 * All WebRTC and Socket.IO logic is in VideoConsultation.jsx
 */
const App = () => {
  return <VideoConsultation />;
};

export default App;