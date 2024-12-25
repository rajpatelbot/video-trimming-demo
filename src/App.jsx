import { useEffect, useRef, useState } from "react";
import Nouislider from "nouislider-react";
import "nouislider/distribute/nouislider.css";
import "./App.css";

let ffmpeg;

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [videoSrc, setVideoSrc] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [videoTrimmedUrl, setVideoTrimmedUrl] = useState("");
  const videoRef = useRef();

  // Convert the time obtained from the video to HH:MM:SS format
  const convertToHHMMSS = (val) => {
    const secNum = parseInt(val, 10);
    let hours = Math.floor(secNum / 3600);
    let minutes = Math.floor((secNum - hours * 3600) / 60);
    let seconds = secNum - hours * 3600 - minutes * 60;

    if (hours < 10) hours = "0" + hours;
    if (minutes < 10) minutes = "0" + minutes;
    if (seconds < 10) seconds = "0" + seconds;

    return hours === "00" ? `${minutes}:${seconds}` : `${hours}:${minutes}:${seconds}`;
  };

  useEffect(() => {
    const loadFFmpegScript = async () => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.2/dist/ffmpeg.min.js";
      script.onload = async () => {
        ffmpeg = window.FFmpeg.createFFmpeg({ log: true });
        await ffmpeg.load();
        setIsScriptLoaded(true);
      };
      document.body.appendChild(script);
    };

    loadFFmpegScript();
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.onloadedmetadata = () => {
        const duration = videoRef.current.duration;
        setVideoDuration(duration);
        setEndTime(duration);
      };
    }
  }, [videoSrc]);

  const updateOnSliderChange = (values, handle) => {
    setVideoTrimmedUrl("");
    let readValue = Math.floor(values[handle]);

    if (handle === 1) {
      setEndTime(readValue);
    } else {
      setStartTime(readValue);
      if (videoRef.current) videoRef.current.currentTime = readValue;
    }
  };

  const handlePlay = () => {
    if (videoRef.current) videoRef.current.play();
  };

  const handlePauseVideo = (e) => {
    if (Math.floor(e.currentTarget.currentTime) === endTime) {
      e.currentTarget.pause();
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];

    if (file) {
      const blobURL = URL.createObjectURL(file);
      setVideoFile(file);
      setVideoSrc(blobURL);
    } else {
      alert("Please select file first");
    }
  };

  const chunkTheVideo = async (videoFile, videoFileType, chunkSize = 50 * 1024 * 1024) => {
    const totalChunks = Math.ceil(videoFile.size / chunkSize),
      chunkFiles = [];
    let currPosition = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunk = videoFile.slice(currPosition, currPosition + chunkSize);
      currPosition += chunkSize;

      // Calculate the chunk's start and end times based on the video duration
      const chunkStartTime = ((i * chunkSize) / videoFile.size) * videoDuration;
      const chunkEndTime = (((i + 1) * chunkSize) / videoFile.size) * videoDuration;

      // Include only chunks that intersect with the trimming range
      if (chunkStartTime < endTime && chunkEndTime > startTime) {
        const chunkName = `chunk-${i}.${videoFileType}`;
        const arrayBuffer = await chunk.arrayBuffer();
        ffmpeg.FS("writeFile", chunkName, new Uint8Array(arrayBuffer));
        chunkFiles.push(chunkName);
      }
    }

    return chunkFiles;
  };

  const concateUint8Arrays = (arrays) => {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      combined.set(arr, offset);
      offset += arr.length;
    }
    return combined;
  };

  const concatVideoChunks = async (chunksFiles, videoFileType) => {
    if (chunksFiles.length === 0) {
      console.log("No chunks files is concatenate");
    }

    try {
      const chunkDataArray = await Promise.all(chunksFiles.map((fileName) => ffmpeg.FS("readFile", fileName)));

      const combinedArray = concateUint8Arrays(chunkDataArray);

      const combinedFileName = `combined-video.${videoFileType}`;
      ffmpeg.FS("writeFile", combinedFileName, combinedArray);

      return combinedFileName;
    } catch (error) {
      console.log({ error });
    }
  };

  const handleTrim = async () => {
    try {
      setIsLoading(true);

      const { type } = videoFile;
      const videoFileType = type.split("/")[1];

      if (isScriptLoaded && videoFile) {
        const chunksFiles = await chunkTheVideo(videoFile, videoFileType);

        const concatChunks = await concatVideoChunks(chunksFiles, videoFileType);

        const duration = endTime - startTime;
        const outputFileName = `output-trimmed-0.mp4`;

        await ffmpeg.run(
          "-v",
          "verbose",
          "-i",
          concatChunks,
          "-ss",
          String(startTime),
          "-t",
          String(duration),
          "-c",
          "copy",
          "-movflags",
          outputFileName
        );

        // Check if the output file exists after trimming
        const outputFileExists = ffmpeg.FS("readdir", "/").includes(outputFileName);

        if (!outputFileExists) {
          throw new Error(`Output file ${outputFileName} does not exist after trim.`);
        }

        // Read the processed file and generate the Blob
        const trimmedChunk = ffmpeg.FS("readFile", outputFileName);
        const finalVideo = new Blob([trimmedChunk.buffer], {
          type: "video/mp4",
        });

        // Create a URL for the trimmed video and set it
        setVideoTrimmedUrl(URL.createObjectURL(finalVideo));
      }
    } catch (error) {
      console.error("Error in handleTrim:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      {isScriptLoaded ? <input type="file" accept="video/*" onChange={handleFileUpload} /> : <p>Loading...</p>}

      <br />

      {videoSrc.length ? (
        <div style={{ maxWidth: "100vw" }}>
          <video style={{ maxWidth: "100%" }} src={videoSrc} ref={videoRef} onTimeUpdate={handlePauseVideo}>
            <source src={videoSrc} type={videoFile.type} />
          </video>
          <br />
          {videoDuration ? (
            <Nouislider
              behaviour="tap-drag"
              step={1}
              margin={3}
              limit={Math.round(videoDuration)}
              range={{ min: 0, max: videoDuration }}
              start={[0, videoDuration]}
              connect
              onUpdate={updateOnSliderChange}
            />
          ) : null}
          <br />
          Start duration: {convertToHHMMSS(startTime)} &nbsp; End duration: {convertToHHMMSS(endTime)}
          <br />
          <button onClick={handlePlay}>Play</button> &nbsp;
          <button onClick={handleTrim}>{isLoading ? "Trimming..." : "Trim"}</button>
          <br />
          {videoTrimmedUrl && (
            <video controls style={{ maxWidth: "100%" }}>
              <source src={videoTrimmedUrl} type={videoFile.type} />
            </video>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default App;
