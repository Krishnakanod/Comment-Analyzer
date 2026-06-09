FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y libgomp1

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ ./backend/

COPY tfidf_vectorizer.pkl /app/tfidf_vectorizer.pkl

RUN python -m nltk.downloader stopwords wordnet

EXPOSE 5000

CMD ["python","-m" ,"backend.app"]
