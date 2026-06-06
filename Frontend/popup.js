// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const outputDiv = document.getElementById("output");
  const API_URL = 'http://localhost:5000';
  let fetchedComments = [];

  // HARDCODED YOUTUBE API KEY
  // Replace the string below with your actual YouTube Data v3 API key
  let API_KEY = '' ;
  try {
    outputDiv.innerHTML = `<p style="color:#aaa;"> Loading config...</p>`;
    const configRes = await fetch(`${API_URL}/config`);
    if (!configRes.ok) throw new Error(`Backend responded with status ${configRes.status}`);
    const config = await configRes.json();
    API_KEY = config.youtube_api_key || '';
    if (!API_KEY) throw new Error('YOUTUBE_API_KEY is missing in server .env');
  } catch (err) {
    outputDiv.innerHTML = `<p style="color:#e74c3c;"> Could not load config from backend: ${err.message}<br><small>Make sure your Flask server is running at ${API_URL}</small></p>`;
    return;
  }

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
        const sentimentCounts = { "1": 0, "0": 0, "-1": 0 };
        const sentimentData = [];
        const totalSentimentScore = predictions.reduce((sum, item) => sum + parseInt(item.sentiment), 0);
        
        predictions.forEach((item) => {
          sentimentCounts[item.sentiment]++;
          sentimentData.push({
            timestamp: item.timestamp,
            sentiment: parseInt(item.sentiment)
          });
        });

        const totalComments = comments.length;
        const uniqueCommenters = new Set(comments.map(comment => comment.authorId)).size;
        const totalWords = comments.reduce((sum, comment) => sum + comment.text.split(/\s+/).filter(word => word.length > 0).length, 0);
        const avgWordLength = (totalWords / totalComments).toFixed(2);
        const avgSentimentScore = (totalSentimentScore / totalComments).toFixed(2);
        const normalizedSentimentScore = (((parseFloat(avgSentimentScore) + 1) / 2) * 10).toFixed(2);

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

        outputDiv.innerHTML += `
          <div class="section">
            <button id="summarize-button" class="primary-button">Generate AI Summary</button>
            <div id="summary-container" class="section"></div>
          </div>
        `;

        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Sentiment Analysis Results</div>
            <p>Pie chart for comment sentiment distribution.</p>
            <div id="chart-container"></div>
          </div>`;

        await fetchAndDisplayChart(sentimentCounts);

        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Sentiment Trend Over Time</div>
            <div id="trend-graph-container"></div>
          </div>`;

        await fetchAndDisplayTrendGraph(sentimentData);

        outputDiv.innerHTML += `
          <div class="section">
            <div class="section-title">Comment Wordcloud</div>
            <div id="wordcloud-container"></div>
          </div>`;

        await fetchAndDisplayWordCloud(comments.map(comment => comment.text));

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
      while (true) {
        const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&pageToken=${pageToken}&key=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        // Surface any YouTube API errors clearly
        if (data.error) {
          const msg = data.error.message || JSON.stringify(data.error);
          const code = data.error.code || response.status;
          outputDiv.innerHTML += `<p style="color:#e74c3c;">❌ YouTube API error (${code}): ${msg}</p>`;
          console.error("YouTube API error:", data.error);
          break;
        }

        if (data.items) {
          data.items.forEach(item => {
            const commentText = item.snippet.topLevelComment.snippet.textOriginal;
            const timestamp = item.snippet.topLevelComment.snippet.publishedAt;
            const authorId = item.snippet.topLevelComment.snippet.authorChannelId?.value || 'Unknown';
            comments.push({ text: commentText, timestamp: timestamp, authorId: authorId });
          });
        }
        pageToken = data.nextPageToken;
        // Break the loop when there are no more pages of comments
        if (!pageToken) break;
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
      outputDiv.innerHTML += `<p style="color:#e74c3c;">❌ Network error fetching comments: ${error.message}</p>`;
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
        return result;
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
      if (!response.ok) throw new Error('Failed to fetch chart image');
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      document.getElementById('chart-container').appendChild(img);
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
      if (!response.ok) throw new Error('Failed to fetch word cloud image');
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      document.getElementById('wordcloud-container').appendChild(img);
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
      if (!response.ok) throw new Error('Failed to fetch trend graph image');
      const blob = await response.blob();
      const imgURL = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgURL;
      img.style.width = '100%';
      img.style.marginTop = '20px';
      document.getElementById('trend-graph-container').appendChild(img);
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
          <p> Generating summary...</p>
          <div class="progress-bar">
            <div class="progress-fill" style="width: 33%;"></div>
          </div>
          <p style="font-size: 0.9em; color: #999;">Processing ${fetchedComments.length} comments...</p>
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

      if (!response.ok) throw new Error(result.error || 'Summarization failed');

      // Sanitize the summary text to remove non-English characters if needed
      const sanitizeText = (text) => {
        if (!text) return '';
        // Remove non-printable characters and limit to basic ASCII/Unicode ranges
        // Safely removes invisible control characters but keeps emojis, newlines, and all languages
        //made change
        return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
      };

      const summaryText = sanitizeText(result.summary) || 'No summary was returned.';
      const metadata = result.processing_time_sec || elapsed_time;

      // Improved fallback mechanism for parsing sections
      let sections;
      try {
        sections = parseSummaryIntoSections(summaryText);
      } catch (parseError) {
        console.warn('Failed to parse summary sections:', parseError);
        sections = { positive: '', critical: '', themes: '', actions: '', metrics: '' };
      }

      // Ensure we still render something even if parsing fails completely
      if (!sections.positive && !sections.critical && !sections.themes && !sections.actions && !sections.metrics) {
        summaryContainer.innerHTML = `

            <div class="ai-summary-body">
              <div class="ai-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-teal"></span>
                  <span>Summary</span>
                </div>
                <p>${sanitizeText(summaryText)}</p>
              </div>
            </div>
          </div>
        `;
      } else {
        summaryContainer.innerHTML = `
          <div class="ai-summary-wrapper">
            <div class="ai-summary-header">
              <span class="ai-summary-icon"></span>
              <span class="ai-summary-title">AI Comment Analysis</span>
            </div>
            <div class="ai-summary-body">
              ${sections.positive ? `
              <div class="ai-section positive-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-green"></span>
                  <span>Strong Points</span>
                </div>
                <ul class="ai-list">${sections.positive}</ul>
              </div>` : ''}
              ${sections.critical ? `
              <div class="ai-section critical-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-red"></span>
                  <span>Critical Feedback</span>
                </div>
                <ul class="ai-list">${sections.critical}</ul>
              </div>` : ''}
              ${sections.themes ? `
              <div class="ai-section themes-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-yellow"></span>
                  <span>Sentiment Themes</span>
                </div>
                <ul class="ai-list">${sections.themes}</ul>
              </div>` : ''}
              ${sections.actions ? `
              <div class="ai-section actions-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-purple"></span>
                  <span>Recommended Actions</span>
                </div>
                <ul class="ai-list">${sections.actions}</ul>
              </div>` : ''}
              ${sections.metrics ? `
              <div class="ai-section metrics-section">
                <div class="ai-section-label">
                  <span class="ai-section-dot dot-teal"></span>
                  <span>Key Metrics</span>
                </div>
                <ul class="ai-list">${sections.metrics}</ul>
              </div>` : ''}
            </div>
          </div>
        `;
      }
      addSummaryStyles();
    } catch (error) {
      console.error('Error fetching AI summary:', error);
      summaryContainer.innerHTML = `<p style="color: #e74c3c;">❌ Error generating summary: ${error.message}</p>`;
    }
  }

  function parseSummaryIntoSections(text) {
    const sanitizedText = sanitizeText(text);
    const sections = { positive: '', critical: '', themes: '', actions: '', metrics: '' };
    const positiveMatch = sanitizedText.match(/##\s*POSITIVE\s*ASPECTS\s*\n([\s\S]*?)(?=##|$)/i);
    if (positiveMatch) sections.positive = formatTextContent(positiveMatch[1]);
    const criticalMatch = sanitizedText.match(/##\s*CRITICAL\s*ISSUES\s*\n([\s\S]*?)(?=##|$)/i);
    if (criticalMatch) sections.critical = formatTextContent(criticalMatch[1]);
    const themesMatch = sanitizedText.match(/##\s*SENTIMENT\s*THEMES\s*\n([\s\S]*?)(?=##|$)/i);
    if (themesMatch) sections.themes = formatTextContent(themesMatch[1]);
    const actionsMatch = sanitizedText.match(/##\s*RECOMMENDED\s*ACTIONS\s*\n([\s\S]*?)(?=##|$)/i);
    if (actionsMatch) sections.actions = formatTextContent(actionsMatch[1]);
    const metricsMatch = sanitizedText.match(/##\s*KEY\s*METRICS\s*\n([\s\S]*?)(?=##|$)/i);
    if (metricsMatch) sections.metrics = formatTextContent(metricsMatch[1]);
    return sections;
  }

  function formatTextContent(text) {
    if (!text) return '';
    return text
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('##')) return '';
        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          const content = cleanMarkdown(trimmed.replace(/^[-*]\s*/, ''));
          return `<li>${content}</li>`;
        }
        return `<p>${cleanMarkdown(trimmed)}</p>`;
      })
      .filter(Boolean)
      .join('');
  }

  function cleanMarkdown(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
  // made change at 450
  function sanitizeText(text) {
    if (!text) return '';
     return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  }

  function addSummaryStyles() {
    const styleId = 'summary-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* ── Wrapper ── */
      .ai-summary-wrapper {
        border: 1px solid #2e2e2e;
        border-radius: 10px;
        overflow: hidden;
        margin: 14px 0;
        background: #1c1c1e;
      }

      /* ── Header bar ── */
      .ai-summary-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px 14px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-bottom: 1px solid #2e2e3e;
      }
      .ai-summary-icon {
        font-size: 1em;
        color: #7c6af7;
      }
      .ai-summary-title {
        font-size: 0.95em;
        font-weight: 700;
        color: #e0e0e0;
        letter-spacing: 0.02em;
        flex: 1;
      }
      .ai-summary-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .meta-badge {
        padding: 3px 9px;
        border-radius: 20px;
        font-size: 0.75em;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .badge-green  { background: #1a3d2b; color: #4caf77; border: 1px solid #2d5c3e; }
      .badge-blue   { background: #0d2a40; color: #4ab0e8; border: 1px solid #1a4a6e; }
      .badge-purple { background: #25183d; color: #a07af5; border: 1px solid #3d2860; }
      .badge-gray   { background: #252525; color: #aaaaaa; border: 1px solid #363636; }

      /* ── Body ── */
      .ai-summary-body {
        padding: 10px 14px 6px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* ── Individual section cards ── */
      .ai-section {
        border-radius: 7px;
        padding: 10px 13px;
        border: 1px solid transparent;
      }
      .ai-section-label {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 0.78em;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #aaaaaa;
        margin-bottom: 7px;
      }
      .ai-section-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .dot-green  { background: #4caf77; }
      .dot-red    { background: #e05c5c; }
      .dot-yellow { background: #f0b429; }
      .dot-purple { background: #a07af5; }
      .dot-teal   { background: #2ec4b6; }

      .positive-section { background: #111d15; border-color: #1e3a24; }
      .critical-section { background: #1d1111; border-color: #3a1e1e; }
      .themes-section   { background: #1d1a0f; border-color: #3a320f; }
      .actions-section  { background: #18112a; border-color: #30204a; }
      .metrics-section  { background: #0f1d1c; border-color: #163432; }

      /* ── List ── */
      .ai-list {
        margin: 0;
        padding: 0 0 0 4px;
        list-style: none;
      }
      .ai-list li {
        position: relative;
        padding: 4px 0 4px 16px;
        font-size: 0.88em;
        line-height: 1.55;
        color: #d0d0d0;
        border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .ai-list li:last-child { border-bottom: none; }
      .ai-list li::before {
            content: '●';
            color: #7c6af7;
            font-size: 0.65em;
      }
      .ai-list p {
        margin: 4px 0;
        font-size: 1em;
        line-height: 2;
        color: #d0d0d0;
      }
      .ai-list strong { color: #ffffff; }
      .ai-list em     { color: #b0c4de; font-style: italic; }
      .ai-list code   { background: #2a2a2a; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }

      /* ── Raw toggle ── */
      .ai-raw-toggle {
        margin: 8px 14px 14px;
        border-radius: 6px;
        border: 1px solid #2e2e2e;
        overflow: hidden;
      }
      .ai-raw-toggle summary {
        cursor: pointer;
        padding: 8px 12px;
        font-size: 0.78em;
        color: #666;
        user-select: none;
        background: #1a1a1a;
        list-style: none;
      }
      .ai-raw-toggle summary:hover { color: #999; }
      .ai-raw-text {
        margin: 0;
        padding: 10px 12px;
        font-size: 0.78em;
        line-height: 1.5;
        color: #888;
        background: #141414;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: auto;
        border-top: 1px solid #2e2e2e;
      }

      /* ── Progress ── */
      .progress-container { text-align: center; padding: 16px; }
      .progress-bar { width: 100%; height: 5px; background: #2a2a2a; border-radius: 10px; overflow: hidden; margin: 10px 0; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #7c6af7, #2ecc71); animation: ai-progress 1.5s ease-in-out infinite; }
      @keyframes ai-progress { 0%, 100% { width: 30%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } }
    `;
    document.head.appendChild(style);
  }

}); // END DOMContentLoaded