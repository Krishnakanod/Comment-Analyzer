// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const outputDiv = document.getElementById("output");
  const API_KEY = 'AIzaSyBogfaYZY5cmUFgSjAJhZClCc8Z7xlQ-3o';  // Replace with your actual YouTube Data API key
  const API_URL = 'http://localhost:5000';
  let fetchedComments = [];

  // Get the current tab's URL
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const url = tabs[0].url;
    const youtubeRegex = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/;
    const match = url.match(youtubeRegex);

    if (match && match[1]) {
      const videoId = match[1];
      outputDiv.innerHTML = `<div class="section-title">YouTube Video ID</div><p>${videoId}</p><p>Fetching comments...</p>`;

      const comments = await fetchComments(videoId);
      if (comments.length === 0) {
        outputDiv.innerHTML += "<p>No comments found for this video.</p>";
        return;
      }

      outputDiv.innerHTML += `<p>Fetched ${comments.length} comments. Performing sentiment analysis...</p>`;
      const predictions = await getSentimentPredictions(comments);

      if (predictions) {
        // Process the predictions to get sentiment counts and sentiment data
        const sentimentCounts = { "1": 0, "0": 0, "-1": 0 };
        const sentimentData = []; // For trend graph
        const totalSentimentScore = predictions.reduce((sum, item) => sum + parseInt(item.sentiment), 0);
        predictions.forEach((item, index) => {
          sentimentCounts[item.sentiment]++;
          sentimentData.push({
            timestamp: item.timestamp,
            sentiment: parseInt(item.sentiment)
          });
        });

        // Compute metrics
        const totalComments = comments.length;
        const uniqueCommenters = new Set(comments.map(comment => comment.authorId)).size;
        const totalWords = comments.reduce((sum, comment) => sum + comment.text.split(/\s+/).filter(word => word.length > 0).length, 0);
        const avgWordLength = (totalWords / totalComments).toFixed(2);
        const avgSentimentScore = (totalSentimentScore / totalComments).toFixed(2);

        // Normalize the average sentiment score to a scale of 0 to 10
        const normalizedSentimentScore = (((parseFloat(avgSentimentScore) + 1) / 2) * 10).toFixed(2);

        // Add the Comment Analysis Summary section
        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Comment Analysis Summary</div>
            <div class="metrics-container">
              <div class="metric">
                <div class="metric-title">Total Comments</div>
                <div class="metric-value">${totalComments}</div>
              </div>
              <div class="metric">
                <div class="metric-title">Unique Commenters</div>
                <div class="metric-value">${uniqueCommenters}</div>
              </div>
              <div class="metric">
                <div class="metric-title">Avg Comment Length</div>
                <div class="metric-value">${avgWordLength} words</div>
              </div>
              <div class="metric">
                <div class="metric-title">Avg Sentiment Score</div>
                <div class="metric-value">${normalizedSentimentScore}/10</div>
              </div>
            </div>
          </div>
        `;

        // Add the AI Summarizer section
        outputDiv.innerHTML += `
          <div class="section">
            <button id="summarize-button" class="primary-button">Generate AI Summary</button>
            <div id="summary-container" class="section"></div>
          </div>
        `;

        // Add the Sentiment Analysis Results section with a placeholder for the chart
        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Sentiment Analysis Results</div>
            <p>See the pie chart below for sentiment distribution.</p>
            <div id="chart-container"></div>
          </div>`;

        // Fetch and display the pie chart inside the chart-container div
        await fetchAndDisplayChart(sentimentCounts);

        // Add the Sentiment Trend Graph section
        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Sentiment Trend Over Time</div>
            <div id="trend-graph-container"></div>
          </div>`;

        // Fetch and display the sentiment trend graph
        await fetchAndDisplayTrendGraph(sentimentData);

        // Add the Word Cloud section
        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Comment Wordcloud</div>
            <div id="wordcloud-container"></div>
          </div>`;

        // Fetch and display the word cloud inside the wordcloud-container div
        await fetchAndDisplayWordCloud(comments.map(comment => comment.text));

        // Add the top comments section
        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Top 25 Comments with Sentiments</div>
            <ul class="comment-list">
              ${predictions.slice(0, 25).map((item, index) => `
                <li class="comment-item">
                  <span>${index + 1}. ${item.comment}</span><br>
                  <span class="comment-sentiment">Sentiment: ${item.sentiment}</span>
                </li>`).join('')}
            </ul>
          </div>`;
      }
    } else {
      outputDiv.innerHTML = "<p>This is not a valid YouTube URL.</p>";
    }
    // Attach event listener using event delegation
    outputDiv.addEventListener('click', async (event) => {
      if (event.target && event.target.id === 'summarize-button') {
        await handleSummarizeComments();
      }
    });
  });

  async function fetchComments(videoId) {
    let comments = [];
    let pageToken = "";
    try {
      // Fetch ALL available comments (no hard limit)
      while (true) {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&pageToken=${pageToken}&key=${API_KEY}`);
        const data = await response.json();
        if (data.items) {
          data.items.forEach(item => {
            const commentText = item.snippet.topLevelComment.snippet.textOriginal;
            const timestamp = item.snippet.topLevelComment.snippet.publishedAt;
            const authorId = item.snippet.topLevelComment.snippet.authorChannelId?.value || 'Unknown';
            comments.push({ text: commentText, timestamp: timestamp, authorId: authorId });
          });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
      outputDiv.innerHTML += "<p>Error fetching comments.</p>";
    }
    fetchedComments = comments;
    return comments;
  }

  async function getSentimentPredictions(comments) {
    try {
      const response = await fetch(`${API_URL}/predict_with_timestamps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments })
      });
      const result = await response.json();
      if (response.ok) {
        return result; // The result now includes sentiment and timestamp
      } else {
        throw new Error(result.error || 'Error fetching predictions');
      }
    } catch (error) {
      console.error("Error fetching predictions:", error);
      outputDiv.innerHTML += "<p>Error fetching sentiment predictions.</p>";
      return null;
    }
  }

  async function fetchAndDisplayChart(sentimentCounts) {
    try {
      const response = await fetch(`${API_URL}/generate_chart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentiment_counts: sentimentCounts })
      });
      if (!response.ok) {
        throw new Error('Failed to fetch chart image');
      }
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      // Append the image to the chart-container div
      const chartContainer = document.getElementById('chart-container');
      chartContainer.appendChild(img);
    } catch (error) {
      console.error("Error fetching chart image:", error);
      outputDiv.innerHTML += "<p>Error fetching chart image.</p>";
    }
  }

  async function fetchAndDisplayWordCloud(comments) {
    try {
      const response = await fetch(`${API_URL}/generate_wordcloud`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments })
      });
      if (!response.ok) {
        throw new Error('Failed to fetch word cloud image');
      }
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      // Append the image to the wordcloud-container div
      const wordcloudContainer = document.getElementById('wordcloud-container');
      wordcloudContainer.appendChild(img);
    } catch (error) {
      console.error("Error fetching word cloud image:", error);
      outputDiv.innerHTML += "<p>Error fetching word cloud image.</p>";
    }
  }

  async function fetchAndDisplayTrendGraph(sentimentData) {
    try {
      const response = await fetch(`${API_URL}/generate_trend_graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentiment_data: sentimentData })
      });
      if (!response.ok) {
        throw new Error('Failed to fetch trend graph image');
      }
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      // Append the image to the trend-graph-container div
      const trendGraphContainer = document.getElementById('trend-graph-container');
      trendGraphContainer.appendChild(img);
    } catch (error) {
      console.error("Error fetching trend graph image:", error);
      outputDiv.innerHTML += "<p>Error fetching trend graph image.</p>";
    }
  }

  async function handleSummarizeComments() {
    const summaryContainer = document.getElementById('summary-container');
    if (!summaryContainer) return;

    summaryContainer.innerHTML = `
      <div class="section">
        <div class="progress-container">
          <p>⏳ Generating AI summary...</p>
          <div class="progress-bar">
            <div class="progress-fill" style="width: 33%;"></div>
          </div>
          <p style="font-size: 0.9em; color: #999;">Processing {${fetchedComments.length}} comments across multiple batches...</p>
        </div>
      </div>
    `;

    try {
      const start_time = Date.now();
      const response = await fetch(`${API_URL}/summarize_comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: fetchedComments })
      });
      const result = await response.json();
      const elapsed_time = ((Date.now() - start_time) / 1000).toFixed(2);

      if (!response.ok) {
        throw new Error(result.error || 'Summarization failed');
      }

      const summaryText = result.summary || 'No summary was returned.';
      const metadata = result.processing_time_sec || elapsed_time;
      
      // Parse structured summary into sections
      const sections = parseSummaryIntoSections(summaryText);
      
      summaryContainer.innerHTML = `
        <div class="section">
          <div class="section-title">📊 AI Comment Analysis Summary</div>
          
          <div class="summary-metadata">
            <span class="meta-badge">✓ Completed</span>
            <span class="meta-badge">📈 ${result.comment_count} comments</span>
            <span class="meta-badge">⚙️ ${result.batch_count} batches</span>
            <span class="meta-badge">⏱️ ${metadata}s</span>
          </div>
          
          ${sections.positive ? `
          <div class="summary-section positive-section">
            <h3 class="section-subtitle">✅ Video Strong Points</h3>
            <div class="section-content">${sections.positive}</div>
          </div>
          ` : ''}
          
          ${sections.critical ? `
          <div class="summary-section critical-section">
            <h3 class="section-subtitle">⚠️ Critical Issues & Feedback</h3>
            <div class="section-content">${sections.critical}</div>
          </div>
          ` : ''}
          
          ${sections.themes ? `
          <div class="summary-section themes-section">
            <h3 class="section-subtitle">🎯 Main Sentiment Themes</h3>
            <div class="section-content">${sections.themes}</div>
          </div>
          ` : ''}
          
          ${sections.actions ? `
          <div class="summary-section actions-section">
            <h3 class="section-subtitle">💡 Recommended Actions</h3>
            <div class="section-content">${sections.actions}</div>
          </div>
          ` : ''}
          
          ${sections.metrics ? `
          <div class="summary-section metrics-section">
            <h3 class="section-subtitle">📈 Key Metrics</h3>
            <div class="section-content">${sections.metrics}</div>
          </div>
          ` : ''}
          
          <div class="summary-full-text">
            <details>
              <summary>📄 Full Summary (Raw)</summary>
              <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto;">${escapeHtml(summaryText)}</pre>
            </details>
          </div>
        </div>
      `;
      
      // Add CSS styles if not already present
      addSummaryStyles();
    } catch (error) {
      console.error('Error fetching AI summary:', error);
      summaryContainer.innerHTML = `<p style="color: #e74c3c;">❌ Error generating summary: ${error.message}</p>`;
    }
  }
  
  function parseSummaryIntoSections(text) {
    const sections = {
      positive: '',
      critical: '',
      themes: '',
      actions: '',
      metrics: ''
    };
    
    // Parse POSITIVE ASPECTS
    const positiveMatch = text.match(/##\s*POSITIVE\s*ASPECTS\s*\n([\s\S]*?)(?=##|\Z)/i);
    if (positiveMatch) {
      sections.positive = formatTextContent(positiveMatch[1]);
    }
    
    // Parse CRITICAL ISSUES
    const criticalMatch = text.match(/##\s*CRITICAL\s*ISSUES\s*\n([\s\S]*?)(?=##|\Z)/i);
    if (criticalMatch) {
      sections.critical = formatTextContent(criticalMatch[1]);
    }
    
    // Parse SENTIMENT THEMES
    const themesMatch = text.match(/##\s*SENTIMENT\s*THEMES\s*\n([\s\S]*?)(?=##|\Z)/i);
    if (themesMatch) {
      sections.themes = formatTextContent(themesMatch[1]);
    }
    
    // Parse RECOMMENDED ACTIONS
    const actionsMatch = text.match(/##\s*RECOMMENDED\s*ACTIONS\s*\n([\s\S]*?)(?=##|\Z)/i);
    if (actionsMatch) {
      sections.actions = formatTextContent(actionsMatch[1]);
    }
    
    // Parse KEY METRICS
    const metricsMatch = text.match(/##\s*KEY\s*METRICS\s*\n([\s\S]*?)(?=##|\Z)/i);
    if (metricsMatch) {
      sections.metrics = formatTextContent(metricsMatch[1]);
    }
    
    return sections;
  }
  
  function formatTextContent(text) {
    // Convert newlines to br tags and format bullet points
    return text
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
          return `<li>${line.trim().replace(/^[-*]\s*/, '')}</li>`;
        }
        return `<p>${escapeHtml(line)}</p>`;
      })
      .join('')
      .replace(/<li>/g, '<li style="margin-left: 20px; margin-bottom: 5px;">')
      .replace(/(<li>.*<\/li>)/s, '<ul style="list-style: disc; padding-left: 20px;">$1</ul>');
  }
  
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
  
  function addSummaryStyles() {
    const styleId = 'summary-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .summary-metadata {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 15px 0;
        padding: 10px;
        background: #f0f0f0;
        border-radius: 6px;
      }
      
      .meta-badge {
        background: #3498db;
        color: white;
        padding: 5px 10px;
        border-radius: 20px;
        font-size: 0.85em;
        font-weight: bold;
      }
      
      .summary-section {
        margin: 20px 0;
        padding: 15px;
        border-left: 4px solid #3498db;
        background: #f9f9f9;
        border-radius: 4px;
      }
      
      .positive-section {
        border-left-color: #27ae60;
        background: #f0fdf4;
      }
      
      .critical-section {
        border-left-color: #e74c3c;
        background: #fef2f2;
      }
      
      .themes-section {
        border-left-color: #f39c12;
        background: #fffbf0;
      }
      
      .actions-section {
        border-left-color: #9b59b6;
        background: #faf5ff;
      }
      
      .metrics-section {
        border-left-color: #1abc9c;
        background: #f0fffe;
      }
      
      .section-subtitle {
        margin: 0 0 10px 0;
        font-size: 1.1em;
        font-weight: bold;
        color: #2c3e50;
      }
      
      .section-content {
        font-size: 0.95em;
        line-height: 1.6;
      }
      
      .section-content p {
        margin: 8px 0;
        color: #333;
      }
      
      .summary-full-text {
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid #ddd;
      }
      
      .summary-full-text summary {
        cursor: pointer;
        font-weight: bold;
        color: #3498db;
        user-select: none;
      }
      
      .summary-full-text summary:hover {
        color: #2980b9;
      }
      
      .progress-container {
        text-align: center;
      }
      
      .progress-bar {
        width: 100%;
        height: 6px;
        background: #ecf0f1;
        border-radius: 10px;
        overflow: hidden;
        margin: 10px 0;
      }
      
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #3498db, #2ecc71);
        animation: progress 1.5s ease-in-out infinite;
      }
      
      @keyframes progress {
        0%, 100% { width: 33%; }
        50% { width: 66%; }
      }
    `;
    document.head.appendChild(style);
  }
    }
  }
});