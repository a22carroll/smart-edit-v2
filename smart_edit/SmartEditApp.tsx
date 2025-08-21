import React, { useState, useCallback, useRef } from 'react';
import { Upload, Play, FileText, Download, X, Check, RotateCcw, Plus, Trash2 } from 'lucide-react';

// Type definitions
interface VideoFile {
  path: string;
  name: string;
  customName?: string;
}

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResult {
  segments: TranscriptionSegment[];
  duration: number;
}

interface ScriptSegment {
  startTime: number;
  endTime: number;
  content: string;
  videoIndex: number;
  keep: boolean;
}

interface GeneratedScript {
  title: string;
  fullText: string;
  segments: ScriptSegment[];
  targetDurationMinutes: number;
  estimatedDurationSeconds: number;
  userPrompt: string;
}

type ProcessingStep = 'idle' | 'transcribing' | 'generating' | 'complete';

const SmartEditApp: React.FC = () => {
  // Main state
  const [projectName, setProjectName] = useState('Untitled Project');
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>([]);
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(null);
  
  // UI state
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('idle');
  const [activeTab, setActiveTab] = useState<'files' | 'prompt' | 'script' | 'timeline'>('files');
  const [userPrompt, setUserPrompt] = useState('');
  const [targetDuration, setTargetDuration] = useState(10);
  const [logs, setLogs] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Helper functions
  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number): string => {
    return `${(seconds / 60).toFixed(1)}min`;
  };

  // File handling
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];
    const newFiles: VideoFile[] = [];

    Array.from(files).forEach(file => {
      const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      if (videoExtensions.includes(extension)) {
        const videoFile: VideoFile = {
          path: file.webkitRelativePath || file.name, // Use webkitRelativePath for actual path
          name: file.name
        };
        
        if (!videoFiles.some(v => v.path === videoFile.path)) {
          newFiles.push(videoFile);
        }
      }
    });

    if (newFiles.length > 0) {
      setVideoFiles(prev => [...prev, ...newFiles]);
      addLog(`Added ${newFiles.length} video file(s)`);
      
      // Auto-generate project name from first video
      if (projectName === 'Untitled Project' && newFiles.length > 0) {
        const firstName = newFiles[0].name.replace(/\.[^/.]+$/, '');
        setProjectName(`${firstName}_edit`);
      }
    }

    // Reset input
    event.target.value = '';
  }, [videoFiles, projectName, addLog]);

  const removeVideo = useCallback((index: number) => {
    setVideoFiles(prev => prev.filter((_, i) => i !== index));
    addLog(`Removed video file`);
    
    // Reset processing state if no videos left
    if (videoFiles.length === 1) {
      setTranscriptions([]);
      setGeneratedScript(null);
      setCurrentStep('idle');
    }
  }, [videoFiles.length, addLog]);

  const updateCustomName = useCallback((index: number, customName: string) => {
    setVideoFiles(prev => prev.map((file, i) => 
      i === index ? { ...file, customName: customName.trim() || undefined } : file
    ));
  }, []);

  // Processing functions
  const startTranscription = useCallback(async () => {
    if (videoFiles.length === 0) return;
    
    setCurrentStep('transcribing');
    addLog('🎤 Starting video transcription...');
    
    try {
      const videoPaths = videoFiles.map(f => f.path);
      
      // Call Python pipeline via API
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_name: projectName,
          video_paths: videoPaths
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        // Convert pipeline result to UI format
        const transcriptionResults: TranscriptionResult[] = result.data.map((tr: any) => ({
          segments: tr.segments.map((seg: any) => ({
            start: seg.start,
            end: seg.end,
            text: seg.text
          })),
          duration: tr.metadata.total_duration || 0
        }));
        
        setTranscriptions(transcriptionResults);
        setCurrentStep('complete');
        setActiveTab('prompt');
        addLog('🎉 Transcription complete! Ready to create script.');
        
        // Log details
        transcriptionResults.forEach((tr, i) => {
          addLog(`✅ Completed: ${videoFiles[i].name} (${formatDuration(tr.duration)}, ${tr.segments.length} segments)`);
        });
        
      } else {
        throw new Error(result.message || 'Transcription failed');
      }
      
    } catch (error) {
      addLog(`❌ Transcription failed: ${error}`);
      setCurrentStep('idle');
    }
  }, [videoFiles, projectName, addLog]);

  const generateScript = useCallback(async () => {
    if (!userPrompt.trim() || transcriptions.length === 0) return;
    
    setIsGenerating(true);
    addLog('🤖 Generating script from your instructions...');
    
    try {
      // Call Python pipeline via API
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcription_results: transcriptions,
          user_prompt: userPrompt,
          target_duration_minutes: targetDuration
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        // Convert pipeline result to UI format
        const pipelineScript = result.data;
        const script: GeneratedScript = {
          title: pipelineScript.title || projectName,
          fullText: pipelineScript.full_text || '',
          segments: (pipelineScript.segments || []).map((seg: any) => ({
            startTime: seg.start_time || 0,
            endTime: seg.end_time || 0,
            content: seg.content || '',
            videoIndex: seg.video_index || 0,
            keep: seg.keep !== false
          })),
          targetDurationMinutes: pipelineScript.target_duration_minutes || targetDuration,
          estimatedDurationSeconds: pipelineScript.estimated_duration_seconds || 0,
          userPrompt: pipelineScript.user_prompt || userPrompt
        };
        
        setGeneratedScript(script);
        setActiveTab('script');
        addLog(`✅ Script generated! ${script.segments.length} segments selected`);
        
      } else {
        throw new Error(result.message || 'Script generation failed');
      }
      
    } catch (error) {
      addLog(`❌ Script generation failed: ${error}`);
    } finally {
      setIsGenerating(false);
    }
  }, [userPrompt, transcriptions, targetDuration, projectName, addLog]);

  const toggleSegment = useCallback((index: number) => {
    if (!generatedScript) return;
    
    setGeneratedScript(prev => {
      if (!prev) return null;
      return {
        ...prev,
        segments: prev.segments.map((segment, i) => 
          i === index ? { ...segment, keep: !segment.keep } : segment
        )
      };
    });
  }, [generatedScript]);

  const exportEDL = useCallback(async () => {
    if (!generatedScript) return;
    
    const selectedSegments = generatedScript.segments.filter(s => s.keep);
    addLog(`📤 Exporting EDL with ${selectedSegments.length} segments...`);
    
    try {
      // Call Python pipeline via API
      const response = await fetch('/api/export-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generated_script: {
            title: generatedScript.title,
            full_text: generatedScript.fullText,
            segments: generatedScript.segments.map(seg => ({
              start_time: seg.startTime,
              end_time: seg.endTime,
              content: seg.content,
              video_index: seg.videoIndex,
              keep: seg.keep
            })),
            target_duration_minutes: generatedScript.targetDurationMinutes,
            estimated_duration_seconds: generatedScript.estimatedDurationSeconds,
            user_prompt: generatedScript.userPrompt
          },
          video_paths: videoFiles.map(f => f.path),
          output_path: `${projectName}.edl`,
          export_format: 'edl'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        addLog(`✅ EDL exported: ${result.data}`);
        
        // Create download link for the generated file
        const downloadResponse = await fetch(`/api/download/${encodeURIComponent(result.data)}`);
        if (downloadResponse.ok) {
          const blob = await downloadResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${projectName}.edl`;
          a.click();
          window.URL.revokeObjectURL(url);
        }
        
      } else {
        throw new Error(result.message || 'Export failed');
      }
      
    } catch (error) {
      addLog(`❌ Export failed: ${error}`);
    }
  }, [generatedScript, videoFiles, projectName, addLog]);

  // Calculate totals
  const totalDuration = transcriptions.reduce((sum, t) => sum + t.duration, 0);
  const selectedSegments = generatedScript?.segments.filter(s => s.keep) || [];
  const estimatedFinalDuration = selectedSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <FileText className="h-8 w-8 text-blue-600" />
              <h1 className="ml-3 text-2xl font-bold text-gray-900">Smart Edit</h1>
            </div>
            <div className="flex items-center space-x-4">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Project name"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Controls */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              {/* Tab Navigation */}
              <div className="border-b">
                <nav className="flex">
                  {[
                    { id: 'files', label: 'Files', icon: Upload },
                    { id: 'prompt', label: 'Prompt', icon: FileText, disabled: transcriptions.length === 0 },
                    { id: 'script', label: 'Script', icon: Play, disabled: !generatedScript },
                    { id: 'timeline', label: 'Timeline', icon: Download, disabled: !generatedScript }
                  ].map(({ id, label, icon: Icon, disabled }) => (
                    <button
                      key={id}
                      onClick={() => !disabled && setActiveTab(id as any)}
                      disabled={disabled}
                      className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 ${
                        activeTab === id
                          ? 'border-blue-500 text-blue-600'
                          : disabled
                          ? 'border-transparent text-gray-400 cursor-not-allowed'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-6">
                {/* Files Tab */}
                {activeTab === 'files' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Video Files
                      </label>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <Plus className="h-5 w-5 mr-2 text-gray-400" />
                        Add Videos
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="video/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </div>

                    {videoFiles.length > 0 && (
                      <div className="space-y-2">
                        {videoFiles.map((file, index) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {file.name}
                              </p>
                              <input
                                type="text"
                                placeholder="Custom clip name"
                                value={file.customName || ''}
                                onChange={(e) => updateCustomName(index, e.target.value)}
                                className="mt-1 text-xs px-2 py-1 border border-gray-200 rounded w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <button
                              onClick={() => removeVideo(index)}
                              className="ml-2 p-1 text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {videoFiles.length > 0 && (
                      <button
                        onClick={startTranscription}
                        disabled={currentStep === 'transcribing'}
                        className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {currentStep === 'transcribing' ? 'Transcribing...' : 'Start Transcription'}
                      </button>
                    )}
                  </div>
                )}

                {/* Prompt Tab */}
                {activeTab === 'prompt' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Video Instructions
                      </label>
                      <textarea
                        value={userPrompt}
                        onChange={(e) => setUserPrompt(e.target.value)}
                        rows={8}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Describe what you want your video to be about. Be specific about the main topic, target audience, key points to emphasize, content to remove, and overall tone..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Duration
                      </label>
                      <div className="flex items-center">
                        <input
                          type="number"
                          value={targetDuration}
                          onChange={(e) => setTargetDuration(Number(e.target.value))}
                          min="1"
                          max="60"
                          className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-600">minutes</span>
                      </div>
                    </div>

                    <button
                      onClick={generateScript}
                      disabled={!userPrompt.trim() || isGenerating}
                      className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {isGenerating ? 'Generating...' : 'Generate Script'}
                    </button>
                  </div>
                )}

                {/* Script Tab */}
                {activeTab === 'script' && generatedScript && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        {generatedScript.title}
                      </h3>
                      <p className="text-sm text-gray-600">
                        Target: {generatedScript.targetDurationMinutes}min | 
                        Estimated: {formatDuration(generatedScript.estimatedDurationSeconds)} | 
                        Segments: {selectedSegments.length}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Generated Script
                      </label>
                      <textarea
                        value={generatedScript.fullText}
                        onChange={(e) => setGeneratedScript(prev => prev ? { ...prev, fullText: e.target.value } : null)}
                        rows={8}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Timeline Segments
                      </label>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {generatedScript.segments.map((segment, index) => (
                          <div
                            key={index}
                            className={`flex items-start p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                              segment.keep
                                ? 'border-green-200 bg-green-50'
                                : 'border-gray-200 bg-gray-50'
                            }`}
                            onClick={() => toggleSegment(index)}
                          >
                            <div className="flex-shrink-0 mr-3 mt-1">
                              {segment.keep ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <X className="h-4 w-4 text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-600">
                                {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                              </p>
                              <p className="text-sm text-gray-900 mt-1">
                                {segment.content}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveTab('timeline')}
                      className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Review Timeline
                    </button>
                  </div>
                )}

                {/* Timeline Tab */}
                {activeTab === 'timeline' && generatedScript && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Final Timeline</h3>
                      <p className="text-sm text-gray-600">
                        Final Duration: {formatDuration(estimatedFinalDuration)} | 
                        Segments: {selectedSegments.length}
                      </p>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
                      <div className="space-y-2">
                        {selectedSegments.map((segment, index) => (
                          <div key={index} className="flex items-center text-sm">
                            <span className="w-16 text-gray-600 font-mono">
                              {formatTime(segment.startTime)}
                            </span>
                            <span className="flex-1 ml-3 text-gray-900">
                              {segment.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={exportEDL}
                      className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export EDL
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel - Results & Logs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Status Dashboard */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Project Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-600">Videos</p>
                  <p className="text-2xl font-bold text-blue-900">{videoFiles.length}</p>
                  <p className="text-xs text-blue-600">
                    {totalDuration > 0 && formatDuration(totalDuration)}
                  </p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-600">Transcription</p>
                  <p className="text-2xl font-bold text-green-900">
                    {transcriptions.length > 0 ? '✓' : '-'}
                  </p>
                  <p className="text-xs text-green-600">
                    {transcriptions.length > 0 ? 'Complete' : 'Pending'}
                  </p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-purple-600">Script</p>
                  <p className="text-2xl font-bold text-purple-900">
                    {generatedScript ? '✓' : '-'}
                  </p>
                  <p className="text-xs text-purple-600">
                    {generatedScript ? `${selectedSegments.length} segments` : 'Not generated'}
                  </p>
                </div>
              </div>
            </div>

            {/* Activity Log */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b">
                <h2 className="text-lg font-medium text-gray-900">Activity Log</h2>
              </div>
              <div className="p-6">
                <div className="bg-gray-50 rounded-lg p-4 h-64 overflow-y-auto">
                  {logs.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      Ready - Add video files to begin
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {logs.map((log, index) => (
                        <div key={index} className="text-sm font-mono text-gray-700">
                          {log}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmartEditApp;