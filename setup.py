from setuptools import find_packages, setup

setup(
    name='youtube-comments-sentiments-analysis',
    packages=find_packages(),
    version='0.1.0',
    description='a ml model which analyses all the yt video comments',
    author='viraj krishna',
    license='',
    include_package_data=True,
    install_requires=[
        'click',
        'Sphinx',
        'coverage',
        'awscli',
        'flake8',
        'python-dotenv>=0.19.0',
        'mlflow',
        'lightgbm',
        'scikit-learn',
        'flask',
        'flask-cors',
        'pandas',
        'numpy',
        'seaborn',
        'matplotlib',
        'joblib',
        'nltk',
        'wordcloud',
        'pyyaml',
        'google-generativeai',
        'requests'
    ],
)
