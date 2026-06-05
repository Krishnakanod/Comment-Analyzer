import os
import time
import logging
from typing import Dict, List, Optional
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('summarizer.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

load_dotenv()

DEFAULT_BATCH_SIZE = int(os.getenv('SUMMARIZER_BATCH_SIZE', 200))
DEFAULT_PROVIDER = os.getenv('SUMMARIZER_PROVIDER', 'gemini').lower()
DEFAULT_MODEL = os.getenv('SUMMARIZER_MODEL', 'gemini-2.5-flash')
DEFAULT_OPENAI_MODEL = os.getenv('OPENAI_SUMMARIZER_MODEL', 'gpt-4o-mini')
DEFAULT_GEMINI_MODEL = os.getenv('GEMINI_SUMMARIZER_MODEL', 'gemini-2.5-flash')


def chunk_comments(comments: List, batch_size: int) -> List[List]:
    """Split comments into batches.
    
    Args:
        comments: List of comments (either dicts or strings)
        batch_size: Number of comments per batch
    
    Returns:
        List of comment batches
    """
    return [comments[i:i + batch_size] for i in range(0, len(comments), batch_size)]


def retry_with_backoff(func, *args, retries: int = 3, base_delay: float = 2.0, **kwargs):
    last_exception = None
    for attempt in range(1, retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            last_exception = exc
            message = str(exc).lower()
            if attempt == retries or not any(token in message for token in ['rate limit', '429', 'timeout', 'too many requests']):
                raise
            time.sleep(base_delay * attempt)
    raise last_exception


def format_comment_batch(comments: List, batch_index: int, total_batches: int) -> str:
    """Format a batch of comments for the summarization prompt.
    
    Args:
        comments: List of either dicts with 'text' key or plain strings
        batch_index: Current batch number
        total_batches: Total number of batches
    
    Returns:
        Formatted string ready for the API prompt
    """
    ordered_comments = []
    for idx, comment in enumerate(comments, start=1):
        # Handle both dict format (from YouTube fetch) and string format
        if isinstance(comment, dict):
            safe_text = comment.get('text', '').strip().replace('\n', ' ')
        else:
            safe_text = str(comment).strip().replace('\n', ' ')
        
        if safe_text:  # Only add non-empty comments
            ordered_comments.append(f"{idx}. {safe_text}")
    
    header = f"Summarize the following YouTube comments batch {batch_index} of {total_batches}."
    return f"{header}\n\n" + "\n".join(ordered_comments)


def get_summary_prompt(batch_text: str) -> str:
    return (
        "You are an expert YouTube video analyst. Analyze the following comments and provide a structured summary.\n\n"
        f"{batch_text}\n\n"
        "RESPOND WITH THIS EXACT STRUCTURE:\n\n"
        "## POSITIVE ASPECTS\n"
        "List key strengths and praise mentioned.\n\n"
        "## CRITICAL ISSUES\n"
        "List main problems, frustrations, or complaints.\n\n"
        "## SENTIMENT THEMES\n"
        "List 3-4 major sentiment themes with brief descriptions.\n\n"
        "## RECOMMENDED ACTIONS\n"
        "List 3-4 actionable recommendations for the creator.\n\n"
        "## KEY METRICS\n"
        "main complaint topic, engagement level.\n\n"
        "Keep responses concise and actionable. Do not include original comment text."
    )


def openai_summary(prompt: str, model: str, api_key: str) -> str:
    try:
        import openai
    except ImportError as exc:
        raise ImportError('OpenAI package is not installed. Add openai to requirements.') from exc

    openai.api_key = api_key
    response = openai.ChatCompletion.create(
        model=model,
        messages=[
            {"role": "system", "content": "You summarize YouTube comments for a content creator."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.2,
        max_tokens=512,
        top_p=1.0
    )
    return response.choices[0].message.content.strip()


def gemini_summary(prompt: str, model: str, api_key: str) -> str:
    try:
        import google.generativeai as genai_client
    except ImportError as exc:
        raise ImportError('google-generative-ai package is not installed. Add google-generative-ai to requirements.') from exc

    genai_client.configure(api_key=api_key)
    model_instance = genai_client.GenerativeModel(model)
    
    # 3. Generate the text content using the official method and parameters
    response = model_instance.generate_content(
        prompt,
        generation_config={"temperature": 0.2}
    )
    
    # 4. The standard library returns the text directly via the .text attribute
    if response.text:
        return response.text.strip()
        
    raise ValueError('Unexpected or empty response from Gemini API')


def summarize_batch(comments: List, provider: str, model: str, api_key: str, batch_index: int, total_batches: int) -> str:
    """Summarize a single batch of comments.
    
    Args:
        comments: List of comments (either dicts with 'text' key or plain strings)
        provider: AI provider ('openai' or 'gemini')
        model: Model name to use
        api_key: API key for the provider
        batch_index: Current batch number
        total_batches: Total number of batches
    
    Returns:
        Summary text for the batch
    """
    logger.info(f"Starting summarization of batch {batch_index}/{total_batches} with {len(comments)} comments using {provider}")
    prompt = get_summary_prompt(format_comment_batch(comments, batch_index, total_batches))
    if provider == 'openai':
        result = retry_with_backoff(openai_summary, prompt, model, api_key)
    else:
        result = retry_with_backoff(gemini_summary, prompt, model, api_key)
    logger.info(f"Completed batch {batch_index}/{total_batches}")
    return result



def combine_summaries(batch_summaries: List[str], provider: str, model: str, api_key: str) -> str:
    prompt = (
        "Combine the following batch summaries into one cohesive final summary for a YouTube video owner. "
        "Keep the tone concise and actionable.\n\n" + "\n\n".join(batch_summaries)
    )
    if provider == 'openai':
        return retry_with_backoff(openai_summary, prompt, model, api_key)
    return retry_with_backoff(gemini_summary, prompt, model, api_key)


def summarize_comments(
    comments: List,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    batch_size: Optional[int] = None,
    api_key: Optional[str] = None
) -> Dict[str, object]:
    """Summarize a list of YouTube comments using an AI provider.
    
    Handles comments in two formats:
    - Dict format: [{"text": "...", "timestamp": "...", "authorId": "..."}, ...]
    - String format: ["comment1", "comment2", ...]
    
    Splits comments into batches and summarizes each batch sequentially,
    then combines multiple batch summaries into a final summary.
    Limits to maximum 600 comments for summarization to avoid API rate limits.
    
    Args:
        comments: List of comments (dicts or strings)
        provider: AI provider ('openai' or 'gemini'). Uses env SUMMARIZER_PROVIDER if None.
        model: Model name. Uses env SUMMARIZER_MODEL if None.
        batch_size: Comments per batch. Uses env SUMMARIZER_BATCH_SIZE if None (default 200).
        api_key: API key. Auto-detected based on provider if None.
    
    Returns:
        Dict with keys: summary, batch_summaries, provider, comment_count, batch_count, processing_time_sec
    
    Raises:
        ValueError: If required API key is missing
    """
    start_time = time.time()
    logger.info(f"Starting comment summarization: {len(comments) if comments else 0} comments")
    
    if not comments:
        logger.warning("No comments provided for summarization")
        return {
            'summary': '',
            'batch_summaries': [],
            'provider': provider or DEFAULT_PROVIDER,
            'comment_count': 0,
            'batch_count': 0,
            'processing_time_sec': 0,
            'status': 'empty'
        }

    # Validate and prepare input
    if not isinstance(comments, list):
        raise ValueError('Comments must be a list')
    
    # Filter out empty comments
    valid_comments = [c for c in comments if c]
    if not valid_comments:
        logger.warning("All comments were empty after filtering")
        return {
            'summary': '',
            'batch_summaries': [],
            'provider': provider or DEFAULT_PROVIDER,
            'comment_count': 0,
            'batch_count': 0,
            'processing_time_sec': 0,
            'status': 'all_empty'
        }
    
    # Limit to 600 comments for summarization
    if len(valid_comments) > 600:
        logger.info(f"Limiting comments from {len(valid_comments)} to 600 for summarization")
        valid_comments = valid_comments[:600]

    provider = (provider or os.getenv('SUMMARIZER_PROVIDER') or DEFAULT_PROVIDER).lower()
    batch_size = int(batch_size or os.getenv('SUMMARIZER_BATCH_SIZE') or DEFAULT_BATCH_SIZE)
    model = model or os.getenv('SUMMARIZER_MODEL')
    api_key = api_key or os.getenv('OPENAI_API_KEY') if provider == 'openai' else os.getenv('GEMINI_API_KEY')

    logger.info(f"Configuration - Provider: {provider}, Model: {model}, Batch Size: {batch_size}")

    if provider == 'openai' and api_key is None:
        raise ValueError('OPENAI_API_KEY is required for OpenAI summarization')
    if provider != 'openai' and api_key is None:
        raise ValueError('GEMINI_API_KEY is required for Gemini summarization')

    if model is None:
        model = DEFAULT_OPENAI_MODEL if provider == 'openai' else DEFAULT_GEMINI_MODEL

    batches = chunk_comments(valid_comments, batch_size)
    logger.info(f"Comments split into {len(batches)} batches of {batch_size} comments each")
    
    # Process batches sequentially to avoid API rate limits
    batch_start_time = time.time()
    logger.info(f"Processing {len(batches)} batches sequentially")
    batch_summaries = []
    for index, batch in enumerate(batches, start=1):
        batch_summaries.append(summarize_batch(batch, provider, model, api_key, index, len(batches)))
    
    batch_processing_time = time.time() - batch_start_time
    logger.info(f"Batch summarization completed in {batch_processing_time:.2f} seconds")

    # Combine multiple batch summaries
    final_summary = batch_summaries[0]
    if len(batch_summaries) > 1:
        logger.info(f"Combining {len(batch_summaries)} batch summaries into final summary")
        combine_start_time = time.time()
        final_summary = combine_summaries(batch_summaries, provider, model, api_key)
        combine_time = time.time() - combine_start_time
        logger.info(f"Summary combination completed in {combine_time:.2f} seconds")

    total_time = time.time() - start_time
    logger.info(f"Total summarization completed in {total_time:.2f} seconds")

    return {
        'summary': final_summary,
        'batch_summaries': batch_summaries,
        'provider': provider,
        'comment_count': len(valid_comments),
        'batch_count': len(batches),
        'processing_time_sec': round(total_time, 2),
        'batch_processing_time_sec': round(batch_processing_time, 2),
        'status': 'success'
    }
