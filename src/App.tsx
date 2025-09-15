import CollaborativeEditor from './CollaborativeEditor';
import './App.css';

function App() {
  return (
    <div className="App">
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '20px', 
        height: '100vh',
        padding: '20px'
      }}>
        <div style={{ 
          border: '2px solid #e1e5e9', 
          borderRadius: '8px', 
          overflow: 'hidden',
          backgroundColor: '#fff'
        }}>
          <CollaborativeEditor 
            documentId="document-1" 
            title="Meeting Notes"
          />
        </div>
        <div style={{ 
          border: '2px solid #e1e5e9', 
          borderRadius: '8px', 
          overflow: 'hidden',
          backgroundColor: '#fff'
        }}>
          <CollaborativeEditor 
            documentId="document-2" 
            title="Project Brainstorm"
          />
        </div>
      </div>
    </div>
  );
}

export default App;
