import CollaborativeEditor from './CollaborativeEditor';
import './App.css';

function App() {
  return (
    <div className="App">
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr', 
        gap: '20px', 
        height: '100vh',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        <div style={{ 
          border: '2px solid #e1e5e9', 
          borderRadius: '8px', 
          overflow: 'hidden',
          backgroundColor: '#fff',
          height: '100%',
          minHeight: 0
        }}>
          <CollaborativeEditor 
            documentId="document-1" 
            title="Meeting Notes"
          />
        </div>
      </div>
    </div>
  );
}

export default App;
