FROM mcr.microsoft.com/devcontainers/base:debian

WORKDIR /workspaces/jira-autowork

RUN curl -fsSL https://bun.sh/install | bash && \
    cp /root/.bun/bin/bun /usr/local/bin/bun

RUN curl -fsSL https://opencode.ai/install | bash && \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode

RUN echo 'cd /workspaces/jira-autowork' >> /home/vscode/.bashrc \
    && echo 'cd /workspaces/jira-autowork' >> /home/vscode/.zshrc