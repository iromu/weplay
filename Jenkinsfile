pipeline {
    agent none

    triggers {
      upstream(upstreamProjects: "weplay-common/" + env.BRANCH_NAME.replaceAll("/", "%2F"), threshold: hudson.model.Result.SUCCESS)
       }

    stages  {

        stage('Initialize') {
         agent { label 'node'  }
          steps {
            script {
              def node = tool name: 'Node-8.4.0', type: 'jenkins.plugins.nodejs.tools.NodeJSInstallation'
              env.PATH = "${node}/bin:${env.PATH}"
            }
            sh 'node -v'
            sh 'yarn install'
          }
        }

       stage('Build'){
         agent { label 'node'  }
         steps {
          sh 'yarn build'
         }
      }

      stage('Docker arm'){
        agent { label 'arm'  }
        steps {
            sh 'docker build --no-cache -t iromu/weplay-io-arm:latest . -f Dockerfile_arm'
            sh 'docker push iromu/weplay-io-arm:latest'
        }
      }

      stage('Docker amd64'){
        agent { label 'docker'  }
        steps {
            sh 'docker build --no-cache -t iromu/weplay-io:latest . -f Dockerfile'
            sh 'docker push iromu/weplay-io:latest'
        }
       }

      stage('Cleanup'){
        agent any
        steps {
           cleanWs()
        }
      }

    }
}
